// `atlas validate`: check beats, locations, entity stubs and scene specs against the contract.
import { VaultIndex, ENTITY_TYPES, MAP_KINDS, MOVES, isBeatPath, type Location, type Note } from './vault'
import { parseLink } from './links'
import { validateSceneText } from './scene'
import { MAX_ABS_YEAR } from './dates'
import { PATHS } from './config'

export interface Issue {
  file: string
  line: number
  severity: 'error' | 'warning'
  message: string
}

export function validateVault(files: Map<string, string | null>, ix = new VaultIndex(files)): Issue[] {
  const issues: Issue[] = []
  const dpy = ix.config.days_per_year
  const slugs = new Set(ix.config.timelines.map((t) => t.slug))

  for (const n of ix.notes.values()) {
    const add = (key: string | null, message: string, severity: Issue['severity'] = 'error') =>
      issues.push({ file: n.path, line: (key && n.fm.keyLines[key]) || n.fm.startLine || 1, severity, message })
    const inAtlas = n.path.startsWith(PATHS.timeline + '/') || n.path.startsWith(PATHS.entities + '/')
    for (const e of n.fm.errors) issues.push({ file: n.path, line: e.line, severity: inAtlas ? 'error' : 'warning', message: `YAML: ${e.message}` })
    if (n.fm.errors.length) continue
    const d = n.fm.data
    const type = d.type

    // Unquoted wikilinks parse as nested arrays: the most common agent mistake.
    for (const [k, v] of Object.entries(d)) {
      if (Array.isArray(v) && (Array.isArray(v[0]) || v.some((x) => Array.isArray(x)))) {
        add(k, `'${k}' looks like an unquoted wikilink; write it quoted, e.g. ${k}: "[[Name]]" or ${k}: ["[[A]]", "[[B]]"]`)
      }
    }

    if (isBeatPath(n.path)) {
      if (type !== 'beat') add('type', `Files in ${PATHS.timeline}/ must have 'type: beat'`)
      else checkBeat(n, ix, add, dpy, slugs)
      continue
    }
    if (type === undefined) continue
    if (type === 'beat') {
      add('type', `Beats must live in ${PATHS.timeline}/`)
      continue
    }
    if (!ENTITY_TYPES.includes(type as any)) {
      // `type` is only reserved inside Atlas/; elsewhere a foreign value is a warning.
      add('type', `Unknown type '${String(type)}' (expected ${ENTITY_TYPES.join(', ')}, or beat)`, n.path.startsWith('Atlas/') ? 'error' : 'warning')
      continue
    }
    if (d.source !== undefined) {
      const l = parseLink(d.source as string)
      if (!l) add('source', `'source' must be a quoted wikilink such as "[[Supporting Cast#Chara]]"`)
      else {
        const p = ix.resolver.resolve(l.target, n.path)
        if (!p) add('source', `'source' target not found: ${l.raw}`)
        else if (l.heading && !ix.notes.get(p)?.headings.some((h) => h.text.trim().toLowerCase() === l.heading!.toLowerCase())) add('source', `Heading '${l.heading}' not found in ${p}`)
      }
    }
    if (type === 'location') checkLocation(n, ix, add)
  }

  // Calendars in atlas.yaml
  const cfgText = files.get(PATHS.config)
  if (typeof cfgText === 'string') {
    const cals = ix.config.calendars
    const line = (needle: string) => Math.max(1, cfgText.split('\n').findIndex((l) => l.includes(needle)) + 1)
    const slugs = new Set<string>()
    cals.forEach((c, i) => {
      if (!c.slug || typeof c.slug !== 'string') issues.push({ file: PATHS.config, line: line('calendars'), severity: 'error', message: `calendar ${i + 1} needs a 'slug'` })
      else if (slugs.has(c.slug)) issues.push({ file: PATHS.config, line: line(c.slug), severity: 'error', message: `calendar slug '${c.slug}' is used twice` })
      else slugs.add(c.slug)
      if (c.months !== undefined && (!Array.isArray(c.months) || c.months.some((m) => !m || typeof m.name !== 'string' || !Number.isInteger(m.days) || m.days < 1)))
        issues.push({ file: PATHS.config, line: line(c.slug ?? 'months'), severity: 'error', message: `calendar '${c.slug}': months must be a list of {name, days} with whole positive days` })
      if (c.hours_per_day !== undefined && !(Number.isInteger(c.hours_per_day) && c.hours_per_day > 0)) issues.push({ file: PATHS.config, line: line('hours_per_day'), severity: 'error', message: `calendar '${c.slug}': hours_per_day must be a positive whole number` })
      if (c.weekdays !== undefined && (!Array.isArray(c.weekdays) || !c.weekdays.length)) issues.push({ file: PATHS.config, line: line('weekdays'), severity: 'error', message: `calendar '${c.slug}': weekdays must be a non-empty list of names` })
    })
    if (ix.config.active_calendar && !slugs.has(ix.config.active_calendar)) issues.push({ file: PATHS.config, line: line('active_calendar'), severity: 'error', message: `active_calendar '${ix.config.active_calendar}' is not defined` })
  }

  // Shared view file (timeline lanes)
  const viewText = files.get(PATHS.view)
  if (typeof viewText === 'string') {
    try {
      const v = JSON.parse(viewText)
      const lanes = v?.lanes
      if (lanes !== undefined && (typeof lanes !== 'object' || Object.values(lanes).some((p: any) => !p || typeof p.auto !== 'boolean' || !Array.isArray(p.shown))))
        issues.push({ file: PATHS.view, line: 1, severity: 'warning', message: `'lanes' must map a grouping (timeline, character, location) to {auto: true|false, shown: [ids]}` })
    } catch (e: any) {
      issues.push({ file: PATHS.view, line: 1, severity: 'warning', message: `Not valid JSON (the app uses automatic lanes until it is fixed): ${e?.message ?? e}` })
    }
  }

  // Scene specs
  for (const f of ix.files) {
    if (!f.startsWith(PATHS.maps + '/') || !f.endsWith('.scene.json')) continue
    const text = files.get(f)
    if (typeof text !== 'string') continue
    for (const i of validateSceneText(text).issues) issues.push({ file: f, line: i.line, severity: 'error', message: i.message })
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

type Add = (key: string | null, message: string, severity?: Issue['severity']) => void

const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v)

function checkBeat(n: Note, ix: VaultIndex, add: Add, dpy: number, slugs: Set<string>) {
  const d = n.fm.data
  if (typeof d.title !== 'string' || !d.title.trim()) add('title', `Beat needs a 'title'`)
  if (!isInt(d.year)) add(d.year === undefined ? 'type' : 'year', `'year' must be an integer (relative to the epoch; negative = before)`)
  else if (Math.abs(d.year as number) > MAX_ABS_YEAR) add('year', `'year' out of range`)
  for (const [dk, yk] of [['day', 'year'], ['end_day', 'end_year']] as const) {
    if (d[dk] === undefined) continue
    if (!isInt(d[dk]) || (d[dk] as number) < 1 || (d[dk] as number) > dpy) add(dk, `'${dk}' must be an integer from 1 to ${dpy}`)
    if (d[yk] === undefined) add(dk, `'${dk}' needs '${yk}'`)
  }
  if (d.end_year !== undefined) {
    if (!isInt(d.end_year)) add('end_year', `'end_year' must be an integer`)
    else if (isInt(d.year)) {
      const b = ix.beats.find((x) => x.id === n.path)
      if (b && b.endKey !== undefined && b.endKey < b.key) add('end_year', `Span ends before it starts`)
    }
  }
  const hpd = 24
  for (const [hk, mk, dk] of [['hour', 'minute', 'day'], ['end_hour', 'end_minute', 'end_day']] as const) {
    if (d[hk] !== undefined) {
      if (!isInt(d[hk]) || (d[hk] as number) < 0 || (d[hk] as number) >= hpd) add(hk, `'${hk}' must be an integer from 0 to ${hpd - 1} (stored times use 24-hour days)`)
      if (d[dk] === undefined) add(hk, `'${hk}' needs '${dk}'`)
    }
    if (d[mk] !== undefined) {
      if (!isInt(d[mk]) || (d[mk] as number) < 0 || (d[mk] as number) > 59) add(mk, `'${mk}' must be an integer from 0 to 59`)
      if (d[hk] === undefined) add(mk, `'${mk}' needs '${hk}'`)
    }
  }
  if (d.approx !== undefined && typeof d.approx !== 'boolean') add('approx', `'approx' must be true or false`)
  if (d.order !== undefined && typeof d.order !== 'number') add('order', `'order' must be a number`)
  if (d.move !== undefined && !MOVES.includes(d.move as any)) add('move', `'move' must be one of ${MOVES.join(', ')}`)
  if (d.characters !== undefined) {
    if (!Array.isArray(d.characters)) add('characters', `'characters' must be a list of quoted wikilinks`)
    else for (const c of d.characters) checkRef(c, 'characters', 'character', n, ix, add)
  }
  if (d.location !== undefined) checkRef(d.location, 'location', 'location', n, ix, add)
  if (d.move !== undefined && d.location === undefined) add('move', `'move' needs a 'location'`, 'warning')
  if (d.timelines !== undefined) {
    if (!Array.isArray(d.timelines)) add('timelines', `'timelines' must be a list of slugs`)
    else for (const s of d.timelines) if (typeof s !== 'string' || !slugs.has(s)) add('timelines', `Timeline '${String(s)}' is not defined in ${PATHS.config}`, 'warning')
  }
  if (d.main_event !== undefined) checkMainEvent(n, ix, add)
  if (d.follows_main !== undefined && typeof d.follows_main !== 'boolean') add('follows_main', `'follows_main' must be true or false`)
  else if (d.follows_main !== undefined && d.main_event === undefined) add('follows_main', `'follows_main' has no effect without 'main_event'`, 'warning')
  if (d.description !== undefined && typeof d.description === 'string' && d.description.includes('\n')) add('description', `'description' should be one line`, 'warning')
}

function checkMainEvent(n: Note, ix: VaultIndex, add: Add) {
  const v = n.fm.data.main_event
  if (Array.isArray(v)) return // reported as unquoted wikilink
  const l = typeof v === 'string' ? parseLink(v) : null
  if (!l) return add('main_event', `'main_event' must be a quoted wikilink to another event, e.g. main_event: "[[Soren awakens]]"`)
  const p = ix.resolver.resolve(l.target, n.path)
  if (!p) return add('main_event', `${l.raw} does not match any note`)
  if (p === n.path) return add('main_event', `An event cannot be its own main event`)
  if (!ix.beats.some((b) => b.id === p)) return add('main_event', `${l.raw} is not an event (a 'type: beat' file in ${PATHS.timeline}/)`)
  // cycle: follow main links from this beat
  const chain = [n.path]
  let cur = ix.beat(n.path)?.main
  while (cur) {
    if (cur === n.path) {
      const names = [...chain, cur].map((c) => c.split('/').pop()!.replace(/\.md$/, ''))
      return add('main_event', `Main event cycle: ${names.join(' -> ')}`)
    }
    if (chain.includes(cur)) return // a cycle further up; reported on its members
    chain.push(cur)
    cur = ix.beat(cur)?.main
  }
}

function checkRef(v: unknown, key: string, want: string, n: Note, ix: VaultIndex, add: Add) {
  if (Array.isArray(v)) return // reported as unquoted wikilink
  const l = parseLink(v as string)
  if (!l) return add(key, `'${key}' must be a quoted wikilink, got ${JSON.stringify(v)}`)
  const p = ix.resolver.resolve(l.target, n.path)
  if (!p) return add(key, `${l.raw} does not match any note`)
  const id = ix.resolveEntity(v as string, n.path)
  if (!id) {
    if (l.heading) return add(key, `${l.raw} points at a heading with no entity stub; create ${PATHS.entities}/<Name>.md with source: "[[${l.target}#${l.heading}]]"`, 'warning')
    return add(key, `${l.raw} is not tagged 'type: ${want}'`, 'warning')
  }
  const t = ix.entities.get(id)!.type
  if (t !== want) add(key, `${l.raw} is a ${t}, expected a ${want}`, 'warning')
}

function checkLocation(n: Note, ix: VaultIndex, add: Add) {
  const d = n.fm.data
  if (d.map_kind !== undefined && !MAP_KINDS.includes(d.map_kind as any)) add('map_kind', `'map_kind' must be one of ${MAP_KINDS.join(', ')}`)
  if (d.map_pos !== undefined && !(Array.isArray(d.map_pos) && d.map_pos.length === 3 && d.map_pos.every((x) => typeof x === 'number'))) add('map_pos', `'map_pos' must be [x, y, z] numbers`)
  if (d.map_inclination !== undefined && typeof d.map_inclination !== 'number') add('map_inclination', `'map_inclination' must be a number of degrees`)
  if (d.map_size !== undefined && !(typeof d.map_size === 'number' && d.map_size > 0)) add('map_size', `'map_size' must be a positive number`)
  if (d.parent !== undefined) {
    checkRef(d.parent, 'parent', 'location', n, ix, add)
    const chain: string[] = []
    let cur: string | undefined = n.path
    while (cur) {
      if (chain.includes(cur)) {
        add('parent', `Parent cycle: ${[...chain, cur].map((c) => c.split('/').pop()).join(' -> ')}`)
        break
      }
      chain.push(cur)
      cur = (ix.entities.get(cur) as Location | undefined)?.parent
    }
  }
  if (d.map_scene !== undefined) {
    if (typeof d.map_scene !== 'string') add('map_scene', `'map_scene' must be a vault path`)
    else if (!ix.files.includes(d.map_scene)) add('map_scene', `Scene file not found: ${d.map_scene}`)
    else if (!d.map_scene.endsWith('.scene.json')) add('map_scene', `'map_scene' must be a .scene.json file`)
  }
}
