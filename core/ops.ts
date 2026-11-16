// Operations shared by the `atlas` CLI and the MCP server. Pure: they read a file map and return writes.
import { VaultIndex, MAP_KINDS, type Location, type MapKind } from './vault'
import { sortKey } from './dates'
import { formatWhen, parseWhen, type AtlasConfig, type WhenFields } from './config'
import { storedToKey } from './calendar'
import { positionAt, timelineBeats } from './timeline'
import { beatPath, cascadeRedate, newBeatText } from './beats'
import { patchFrontmatter, yamlValue } from './note'
import { PATHS } from './config'
import { validateSceneText } from './scene'

export type Files = Map<string, string | null>
export interface Write { path: string; text: string }

const link = (name: string) => (name.startsWith('[[') ? name : `[[${name}]]`)
const unlink = (s: string) => s.replace(/^\[\[|\]\]$/g, '').split('|')[0]

/** Resolve a name, wikilink or path to an entity id. */
export function findEntity(ix: VaultIndex, ref: string): string | null {
  if (ix.entities.has(ref)) return ref
  const viaLink = ix.resolveEntity(link(ref))
  if (viaLink) return viaLink
  const low = unlink(ref).toLowerCase()
  for (const e of ix.entities.values()) {
    const aliases = Array.isArray(e.data.aliases) ? (e.data.aliases as string[]) : []
    if (e.name.toLowerCase() === low || aliases.some((a) => String(a).toLowerCase() === low)) return e.id
  }
  return null
}

function date(cfg: AtlasConfig, s: string | number): WhenFields {
  const d = parseWhen(cfg, String(s))
  if (!d) throw new Error(`Unreadable date '${s}'. Use e.g. -8, "0 d12", "0 d12 13:45", ~-1000000${cfg.resolved.active.months && cfg.calendars.length ? `, "14 ${cfg.resolved.active.months[0].name} ${cfg.resolved.active.offset}"` : ''}`)
  return d
}

export function queryEntities(files: Files, type?: string) {
  const ix = new VaultIndex(files)
  return [...ix.entities.values()]
    .filter((e) => !type || e.type === type)
    .map((e) => ({ id: e.id, name: e.name, type: e.type, ...(e.type === 'location' ? { kind: (e as Location).kind, parent: (e as Location).parent ?? null } : {}), status: e.data.status ?? null, description: e.data.description ?? null }))
}

export function queryBeats(files: Files, opts: { from?: string; to?: string; character?: string; location?: string; timeline?: string } = {}) {
  const ix = new VaultIndex(files)
  const dpy = ix.config.days_per_year
  let beats = ix.beats
  if (opts.character) {
    const id = findEntity(ix, opts.character)
    if (!id) throw new Error(`No character '${opts.character}'`)
    beats = timelineBeats(ix, { kind: 'character', id })
  }
  if (opts.location) {
    const id = findEntity(ix, opts.location)
    if (!id) throw new Error(`No location '${opts.location}'`)
    const sub = ix.subtree(id)
    beats = beats.filter((b) => b.location && sub.has(b.location))
  }
  if (opts.timeline) beats = beats.filter((b) => b.timelines.includes(opts.timeline!))
  const lo = opts.from !== undefined ? storedToKey(date(ix.config, opts.from)) : -Infinity
  const hi = opts.to !== undefined ? (() => { const d = date(ix.config, opts.to!); return d.day === undefined ? sortKey(d.year, dpy, dpy) + 0.999 : storedToKey(d) })() : Infinity
  return beats
    .filter((b) => (b.endKey ?? b.key) >= lo && b.key <= hi)
    .map((b) => ({ path: b.id, title: b.title, main_event: b.main ? ix.beat(b.main)?.title ?? b.main : null, follows_main: b.follows, year: b.year, day: b.day ?? null, approx: b.approx, hour: b.hour ?? null, minute: b.minute ?? null, date: formatWhen(ix.config, b), characters: b.characters.map((c) => ix.entities.get(c)?.name ?? c), location: b.location ? ix.entities.get(b.location)?.name ?? b.location : null, move: b.move ?? null, timelines: b.timelines }))
}

export function whereWas(files: Files, who: string, when: string | number) {
  const ix = new VaultIndex(files)
  const id = findEntity(ix, who)
  if (!id) throw new Error(`No character '${who}'`)
  const p = positionAt(ix, id, storedToKey(date(ix.config, when)))
  const name = (x?: string) => (x ? ix.entities.get(x)?.name ?? x : null)
  if (p.kind === 'unknown') return { character: name(id), at: null, state: 'unknown' as const }
  if (p.kind === 'at') return { character: name(id), state: 'at' as const, at: name(p.location), path: p.location, since: p.beat.title }
  return { character: name(id), state: 'transit' as const, from: name(p.from), to: name(p.to), progress: p.progress ?? null, since: p.fromBeat.title }
}

export interface AddBeatInput { title: string; date: string | number; characters?: string[]; location?: string; move?: string; timelines?: string[]; status?: string; description?: string; body?: string }

export function addBeat(files: Files, b: AddBeatInput): Write {
  const ix = new VaultIndex(files)
  for (const c of b.characters ?? []) if (!findEntity(ix, c)) throw new Error(`No character '${c}' (tag a note with type: character first)`)
  if (b.location && !findEntity(ix, b.location)) throw new Error(`No location '${b.location}'`)
  if (b.move && !['arrive', 'depart', 'stay'].includes(b.move)) throw new Error(`move must be arrive, depart or stay`)
  const name = (ref: string) => link(ix.entities.get(findEntity(ix, ref)!)!.name)
  const path = beatPath(b.title, (p) => files.has(p))
  return { path, text: newBeatText({ title: b.title, date: date(ix.config, b.date), characters: (b.characters ?? []).map(name), location: b.location ? name(b.location) : undefined, move: b.move, timelines: b.timelines, status: b.status, description: b.description, body: b.body }) }
}

export interface AddLocationInput { name: string; parent?: string; kind?: string; pos?: [number, number, number]; size?: number; color?: string; folder?: string; scene?: Record<string, unknown> | true; status?: string; description?: string }

export function addLocation(files: Files, l: AddLocationInput): Write[] {
  const ix = new VaultIndex(files)
  const kind = (l.kind ?? 'region') as MapKind
  if (!MAP_KINDS.includes(kind)) throw new Error(`kind must be one of ${MAP_KINDS.join(', ')}`)
  const parentId = l.parent ? findEntity(ix, l.parent) : null
  if (l.parent && !parentId) throw new Error(`No parent location '${l.parent}'`)
  const folder = (l.folder ?? 'Atlas/Places').replace(/\/+$/, '')
  const path = `${folder}/${l.name}.md`
  if (files.has(path)) throw new Error(`${path} already exists`)
  const writes: Write[] = []
  const lines = ['---', 'type: location']
  if (parentId) lines.push(`parent: ${yamlValue(link(ix.entities.get(parentId)!.name))}`)
  lines.push(`map_kind: ${kind}`, `map_pos: ${yamlValue(l.pos ?? [0, 0, 0])}`)
  if (l.size) lines.push(`map_size: ${l.size}`)
  if (l.color) lines.push(`map_color: ${yamlValue(l.color)}`)
  if (l.status) lines.push(`status: ${yamlValue(l.status)}`)
  if (l.description) lines.push(`description: ${yamlValue(l.description)}`)
  if (l.scene) {
    const slug = l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const scenePath = `${PATHS.maps}/${slug}.scene.json`
    const defaults: Record<string, string> = { galaxy: 'galaxy', system: 'system', planet: 'planet', continent: 'terrain', region: 'terrain', city: 'city', district: 'city', building: 'plan', room: 'plan' }
    const spec = l.scene === true ? { version: 1, preset: defaults[kind] ?? 'terrain', params: {} } : { version: 1, ...l.scene }
    const text = JSON.stringify(spec, null, 2) + '\n'
    const v = validateSceneText(text)
    if (v.issues.length) throw new Error(`Invalid scene: ${v.issues[0].message}`)
    writes.push({ path: scenePath, text })
    lines.push(`map_scene: ${scenePath}`)
  }
  lines.push('---', '')
  writes.unshift({ path, text: lines.join('\n') })
  return writes
}

/** Set one frontmatter key on a note (by path or entity name), patching only that key's text. */
export function setKey(files: Files, target: string, key: string, value: unknown): Write {
  const ix = new VaultIndex(files)
  const path = files.has(target) ? target : findEntity(ix, target) ?? ix.resolver.resolve(unlink(target))
  if (!path) throw new Error(`No note '${target}'`)
  const text = files.get(path)
  if (typeof text !== 'string') throw new Error(`${path} is not a text note`)
  return { path, text: patchFrontmatter(text, key, value) }
}

const DATE_KEYS = new Set(['year', 'day', 'hour', 'minute'])

/**
 * `atlas set` / MCP set_property: like setKey, but re-dating a beat's start (year, day, hour, minute) also moves
 * its sub-events that follow it (contract 4, Linked events). Returns every file to write.
 */
export function setKeyWrites(files: Files, target: string, key: string, value: unknown): Write[] {
  const w = setKey(files, target, key, value)
  if (!DATE_KEYS.has(key)) return [w]
  const ix = new VaultIndex(files)
  if (!ix.beat(w.path)) return [w]
  return cascadeRedate(ix, w.path, w.text).map(({ path, text }) => ({ path, text }))
}

/** CLI/MCP value parsing: JSON if it parses (numbers, arrays, true/false, "quoted"), else the raw string. */
export function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
