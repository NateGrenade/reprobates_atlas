// In-memory index over vault files. Pure: built from a map of path -> text, no fs access.
import { readFrontmatter, splitNote, type Frontmatter } from './note'
import { findLinks, LinkResolver, normHeading, parseLink, type WikiLink } from './links'
import { extractHeadings, sectionText, type Heading } from './markdown'
import { sortKey } from './dates'
import { parseConfig, PATHS, type AtlasConfig } from './config'

export const ENTITY_TYPES = ['character', 'location', 'faction', 'item', 'event'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
export const MAP_KINDS = ['universe', 'galaxy', 'nebula', 'black_hole', 'region', 'system', 'star', 'planet', 'gas_giant', 'moon', 'dwarf_planet', 'asteroid', 'asteroid_belt', 'comet', 'ring', 'station', 'continent', 'city', 'district', 'building', 'room', 'other'] as const
/** Human names for the Add menu and pickers */
export const MAP_KIND_LABEL: Record<string, string> = { universe: 'Universe', galaxy: 'Galaxy', nebula: 'Nebula', black_hole: 'Black hole', region: 'Region', system: 'Star system', star: 'Star', planet: 'Planet', gas_giant: 'Gas giant', moon: 'Moon', dwarf_planet: 'Dwarf planet', asteroid: 'Asteroid', asteroid_belt: 'Asteroid belt', comet: 'Comet', ring: 'Planetary ring', station: 'Space station', continent: 'Continent', city: 'City', district: 'District', building: 'Building', room: 'Room', other: 'Other place' }
export type MapKind = (typeof MAP_KINDS)[number]
export const MOVES = ['arrive', 'depart', 'stay'] as const
export type Move = (typeof MOVES)[number]

export interface Note {
  path: string
  name: string
  text: string
  fm: Frontmatter
  body: string
  /** 1-based file line where body starts */
  bodyLine: number
  links: WikiLink[]
  headings: Heading[]
}

export interface Entity {
  /** Canonical id = path of the note (or stub) that carries `type:` */
  id: string
  name: string
  type: EntityType
  data: Record<string, unknown>
  /** For stubs: the heading the stub stands for */
  source?: { path: string; heading?: string }
}

export interface Location extends Entity {
  type: 'location'
  parent?: string // entity id
  kind: MapKind
  pos: [number, number, number]
  size?: number
  /** orbit tilt in degrees (rotates the position about the X axis) */
  inclination?: number
  scene?: string
  color?: string
  icon?: string
}

export interface Beat {
  id: string // path
  title: string
  year: number
  day?: number
  approx: boolean
  hour?: number
  minute?: number
  endYear?: number
  endDay?: number
  endHour?: number
  endMinute?: number
  order: number
  characters: string[] // entity ids (resolved only)
  location?: string // entity id
  move?: Move
  timelines: string[]
  status?: string
  description?: string
  key: number
  endKey?: number
  /** `main_event`: id (path) of the main event this one belongs to, when it resolves to a beat */
  main?: string
  /** `follows_main: true`: shift with the main event when it is re-dated */
  follows: boolean
  /** ids of beats whose `main_event` is this one, in timeline order */
  subs: string[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const basename = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')

export function isBeatPath(path: string) {
  return path.startsWith(PATHS.timeline + '/') && path.endsWith('.md')
}

export class VaultIndex {
  notes = new Map<string, Note>()
  files: string[] = []
  entities = new Map<string, Entity>()
  beats: Beat[] = []
  config: AtlasConfig
  resolver: LinkResolver
  /** "notePath#normalized heading" -> stub entity id */
  private headingStubs = new Map<string, string>()
  private backlinkMap = new Map<string, Set<string>>()
  private childMap = new Map<string, string[]>()

  constructor(files: Map<string, string | null>) {
    // files: path -> text for .md (and atlas.yaml), null for other files (images, scenes...)
    this.files = [...files.keys()].sort()
    this.resolver = new LinkResolver(this.files)
    this.config = parseConfig(files.get(PATHS.config) ?? undefined)
    for (const [path, text] of files) {
      if (text === null || !path.toLowerCase().endsWith('.md')) continue
      const fm = readFrontmatter(text)
      const parts = splitNote(text)
      const bodyLine = parts.fmBlock ? parts.fmBlock.split('\n').length - (parts.fmBlock.endsWith('\n') ? 1 : 0) + 1 : 1
      this.notes.set(path, { path, name: basename(path), text, fm, body: parts.body, bodyLine, links: findLinks(parts.body), headings: extractHeadings(parts.body) })
    }
    this.buildEntities()
    this.buildBeats()
    this.buildBacklinks()
  }

  private buildEntities() {
    for (const n of this.notes.values()) {
      const t = n.fm.data.type
      if (!ENTITY_TYPES.includes(t as EntityType)) continue
      const e: Entity = { id: n.path, name: str(n.fm.data.title) ?? n.name, type: t as EntityType, data: n.fm.data }
      const src = parseLink(str(n.fm.data.source) ?? '')
      if (src) {
        const sp = this.resolver.resolve(src.target, n.path)
        if (sp) {
          e.source = { path: sp, heading: src.heading }
          if (src.heading) this.headingStubs.set(sp + '#' + normHeading(src.heading), n.path)
        }
      }
      this.entities.set(e.id, e)
    }
    for (const e of this.entities.values()) {
      if (e.type !== 'location') continue
      const d = e.data
      const loc = e as Location
      loc.kind = (MAP_KINDS.includes(d.map_kind as MapKind) ? d.map_kind : 'other') as MapKind
      const pos = Array.isArray(d.map_pos) && d.map_pos.length === 3 && d.map_pos.every((x) => typeof x === 'number') ? (d.map_pos as [number, number, number]) : [0, 0, 0]
      loc.pos = pos as [number, number, number]
      loc.size = num(d.map_size)
      loc.inclination = num(d.map_inclination)
      loc.scene = str(d.map_scene)
      loc.color = str(d.map_color)
      loc.icon = str(d.map_icon)
      const parent = this.resolveEntity(str(d.parent), e.id)
      if (parent && parent !== e.id) loc.parent = parent
    }
    for (const e of this.locations()) {
      const k = e.parent ?? ''
      const arr = this.childMap.get(k) ?? []
      arr.push(e.id)
      this.childMap.set(k, arr)
    }
  }

  private buildBeats() {
    const dpy = this.config.days_per_year
    const hpd = 24
    const frac = (h?: number, m?: number) => (h === undefined ? 0 : (h + (m ?? 0) / 60) / hpd)
    for (const n of this.notes.values()) {
      if (!isBeatPath(n.path) || n.fm.data.type !== 'beat') continue
      const d = n.fm.data
      const year = num(d.year)
      if (year === undefined) continue
      const day = num(d.day)
      const b: Beat = {
        id: n.path,
        title: str(d.title) ?? n.name,
        year,
        day,
        approx: d.approx === true,
        hour: num(d.hour),
        minute: num(d.minute),
        endYear: num(d.end_year),
        endDay: num(d.end_day),
        endHour: num(d.end_hour),
        endMinute: num(d.end_minute),
        order: num(d.order) ?? 0,
        characters: (Array.isArray(d.characters) ? d.characters : []).map((c) => this.resolveEntity(str(c), n.path)).filter((x): x is string => !!x),
        location: this.resolveEntity(str(d.location), n.path) ?? undefined,
        move: MOVES.includes(d.move as Move) ? (d.move as Move) : undefined,
        timelines: (Array.isArray(d.timelines) ? d.timelines : []).filter((x): x is string => typeof x === 'string'),
        status: str(d.status),
        description: str(d.description),
        follows: d.follows_main === true,
        subs: [],
        key: sortKey(year, day, dpy) + (day !== undefined ? frac(num(d.hour), num(d.minute)) : 0)
      }
      if (b.endYear !== undefined) b.endKey = sortKey(b.endYear, b.endDay ?? dpy, dpy) + (b.endDay !== undefined ? frac(b.endHour, b.endMinute) : 0)
      this.beats.push(b)
    }
    this.beats.sort(compareBeats)
    // linked events: main_event resolves to another beat file (beats are not entities, so resolve the path)
    const byId = new Map(this.beats.map((b) => [b.id, b]))
    for (const b of this.beats) {
      const l = parseLink(str(this.notes.get(b.id)!.fm.data.main_event) ?? '')
      const p = l && !l.heading ? this.resolver.resolve(l.target, b.id) : null
      if (p && p !== b.id && byId.has(p)) {
        b.main = p
        byId.get(p)!.subs.push(b.id)
      }
    }
  }

  beat(id: string): Beat | undefined {
    return this.beats.find((b) => b.id === id)
  }

  private buildBacklinks() {
    for (const n of this.notes.values()) {
      const targets = new Set<string>()
      for (const l of n.links) {
        const p = this.resolver.resolve(l.target, n.path)
        if (p && p !== n.path) targets.add(p)
      }
      for (const v of Object.values(n.fm.data)) {
        for (const s of Array.isArray(v) ? v : [v]) {
          const l = parseLink(s as string)
          const p = l && this.resolver.resolve(l.target, n.path)
          if (p && p !== n.path) targets.add(p)
        }
      }
      for (const t of targets) {
        const set = this.backlinkMap.get(t) ?? new Set()
        set.add(n.path)
        this.backlinkMap.set(t, set)
      }
    }
  }

  /** Resolve a wikilink string to a canonical entity id (heading refs collapse onto their stub). */
  resolveEntity(link: string | undefined, from?: string): string | null {
    if (!link) return null
    const l = parseLink(link)
    if (!l) return null
    const path = this.resolver.resolve(l.target, from)
    if (!path) return null
    if (l.heading) {
      const stub = this.headingStubs.get(path + '#' + normHeading(l.heading))
      if (stub) return stub
      return null
    }
    return this.entities.has(path) ? path : null
  }

  /** Lore markdown for an entity: the source heading's section for stubs, else the note body. */
  loreOf(id: string): string {
    const e = this.entities.get(id)
    if (e?.source) {
      const n = this.notes.get(e.source.path)
      if (n) return e.source.heading ? sectionText(n.body, e.source.heading) ?? '' : n.body
    }
    return this.notes.get(id)?.body ?? ''
  }

  backlinks(path: string): string[] {
    return [...(this.backlinkMap.get(path) ?? [])].sort()
  }

  locations(): Location[] {
    return [...this.entities.values()].filter((e): e is Location => e.type === 'location')
  }

  children(locationId: string | null): string[] {
    return this.childMap.get(locationId ?? '') ?? []
  }

  /** The location and all its descendants (cycle-safe). */
  subtree(locationId: string): Set<string> {
    const out = new Set<string>()
    const stack = [locationId]
    while (stack.length) {
      const id = stack.pop()!
      if (out.has(id)) continue
      out.add(id)
      stack.push(...this.children(id))
    }
    return out
  }

  /** Ancestors from root to the location itself (cycle-safe). */
  ancestry(locationId: string): string[] {
    const chain: string[] = []
    let cur: string | undefined = locationId
    while (cur && !chain.includes(cur)) {
      chain.unshift(cur)
      cur = (this.entities.get(cur) as Location | undefined)?.parent
    }
    return chain
  }
}

export function compareBeats(a: Beat, b: Beat) {
  return a.key - b.key || a.order - b.order || a.title.localeCompare(b.title)
}
