// Creating and re-dating beat files (contract 4). Re-dating never renames.
import { PATHS } from './config'
import { patchFrontmatterMany, readFrontmatter, yamlValue } from './note'
import type { StoryDate } from './dates'

export type BeatDate = StoryDate & { hour?: number; minute?: number }

const BAD = /[\\/:*?"<>|#^\[\]]/g

/** `Atlas/Timeline/<Title>.md`, appending ` 2`, ` 3` on a clash. */
export function beatPath(title: string, exists: (p: string) => boolean): string {
  const base = (title.replace(BAD, ' ').replace(/\s+/g, ' ').trim() || 'Untitled moment').slice(0, 120)
  for (let i = 1; ; i++) {
    const p = `${PATHS.timeline}/${base}${i > 1 ? ' ' + i : ''}.md`
    if (!exists(p) && !exists(p.toLowerCase())) return p
  }
}

export interface NewBeat {
  title: string
  date: BeatDate
  characters?: string[]
  location?: string
  timelines?: string[]
  move?: string
  status?: string
  description?: string
  body?: string
  /** quoted wikilink to the main event (contract 4, Linked events) */
  mainEvent?: string
  followsMain?: boolean
}

export function newBeatText(b: NewBeat): string {
  const lines = ['---', 'type: beat', `title: ${yamlValue(b.title)}`, `year: ${b.date.year}`]
  if (b.date.day) lines.push(`day: ${b.date.day}`)
  if (b.date.day && b.date.hour !== undefined) lines.push(`hour: ${b.date.hour}`)
  if (b.date.day && b.date.hour !== undefined && b.date.minute) lines.push(`minute: ${b.date.minute}`)
  if (b.date.approx) lines.push('approx: true')
  if (b.characters?.length) lines.push(`characters: ${yamlValue(b.characters)}`)
  if (b.location) lines.push(`location: ${yamlValue(b.location)}`)
  if (b.move) lines.push(`move: ${b.move}`)
  if (b.timelines?.length) lines.push(`timelines: ${yamlValue(b.timelines)}`)
  if (b.status) lines.push(`status: ${yamlValue(b.status)}`)
  if (b.description) lines.push(`description: ${yamlValue(b.description)}`)
  if (b.mainEvent) lines.push(`main_event: ${yamlValue(b.mainEvent)}`)
  if (b.mainEvent && b.followsMain) lines.push('follows_main: true')
  lines.push('---', b.body ?? '')
  return lines.join('\n') + (b.body?.endsWith('\n') ? '' : '\n')
}

/** Patch a beat's start (or end) date; only the year/day/approx lines change. */
export function redate(text: string, d: BeatDate, which: 'start' | 'end' = 'start', touchApprox = false, touchTime = false): string {
  const [y, dk, hk, mk] = which === 'start' ? ['year', 'day', 'hour', 'minute'] : ['end_year', 'end_day', 'end_hour', 'end_minute']
  const patch: Record<string, unknown> = { [y]: d.year, [dk]: d.day }
  // time keys change only when the caller sets a time, or explicitly edits the whole date
  if (touchTime || d.hour !== undefined) Object.assign(patch, { [hk]: d.day !== undefined ? d.hour : undefined, [mk]: d.day !== undefined && d.hour !== undefined && d.minute ? d.minute : undefined })
  if (touchApprox && which === 'start') patch.approx = d.approx ? true : undefined
  return patchFrontmatterMany(text, patch)
}

// ---- Linked events (contract 4, "Linked events"): `main_event` + `follows_main` on the sub-event.

export interface DateFields { year: number; day?: number; hour?: number; minute?: number }
export interface BeatWrite { path: string; text: string; before: string }

const MIN_PER_DAY = 1440
const DPY = 365
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Start (or end) date fields as stored in a beat's frontmatter; null when there is no year. */
export function dateFields(data: Record<string, unknown>, which: 'start' | 'end' = 'start'): DateFields | null {
  const [y, d, h, m] = which === 'start' ? ['year', 'day', 'hour', 'minute'] : ['end_year', 'end_day', 'end_hour', 'end_minute']
  if (!isNum(data[y])) return null
  const out: DateFields = { year: data[y] as number }
  if (isNum(data[d])) {
    out.day = data[d] as number
    if (isNum(data[h])) {
      out.hour = data[h] as number
      if (isNum(data[m])) out.minute = data[m] as number
    }
  }
  return out
}

const dayIndex = (f: DateFields) => f.year * DPY + ((f.day ?? 1) - 1)
const minuteIndex = (f: DateFields) => dayIndex(f) * MIN_PER_DAY + (f.hour ?? 0) * 60 + (f.minute ?? 0)

/**
 * Where a sub-event's date goes when its main event moves `from` -> `to`, keeping the sub's own precision:
 * a year-only date moves by the change in the main's year number, a day date by the change in the main's
 * day number (whole days), a timed date by the exact change in minutes. Dragging back restores exactly.
 */
export function shiftFields(sub: DateFields, from: DateFields, to: DateFields): DateFields {
  if (sub.day === undefined) return { year: sub.year + (to.year - from.year) }
  if (sub.hour === undefined) {
    const n = dayIndex(sub) + (dayIndex(to) - dayIndex(from))
    const year = Math.floor(n / DPY)
    return { year, day: n - year * DPY + 1 }
  }
  const t = minuteIndex(sub) + (minuteIndex(to) - minuteIndex(from))
  const dayAbs = Math.floor(t / MIN_PER_DAY)
  const year = Math.floor(dayAbs / DPY)
  const rest = t - dayAbs * MIN_PER_DAY
  return { year, day: dayAbs - year * DPY + 1, hour: Math.floor(rest / 60), minute: rest % 60 }
}

/** Patch only the date keys whose values change; time keys keep their presence (hour 0 stays written). */
function patchDate(text: string, data: Record<string, unknown>, f: DateFields, which: 'start' | 'end'): string {
  const keys = which === 'start' ? ['year', 'day', 'hour', 'minute'] : ['end_year', 'end_day', 'end_hour', 'end_minute']
  const vals = [f.year, f.day, f.hour, f.minute]
  const patch: Record<string, unknown> = {}
  keys.forEach((k, i) => {
    let v = vals[i]
    if (k.endsWith('minute') && v === 0 && data[k] === undefined) v = undefined
    if (v !== undefined && data[k] !== v) patch[k] = v
  })
  return Object.keys(patch).length ? patchFrontmatterMany(text, patch) : text
}

interface LinkIndex {
  beats: { id: string; main?: string; follows: boolean; subs: string[] }[]
  notes: Map<string, { text: string; fm: { data: Record<string, unknown> } }>
}

/** Ids of every opted-in sub-event that moves when `id` moves (transitively; cycle-safe). */
export function followerIds(ix: LinkIndex, id: string): string[] {
  const byId = new Map(ix.beats.map((b) => [b.id, b]))
  const out: string[] = []
  const seen = new Set([id])
  const stack = [id]
  while (stack.length) {
    for (const s of byId.get(stack.pop()!)?.subs ?? []) {
      if (seen.has(s) || !byId.get(s)?.follows) continue
      seen.add(s)
      out.push(s)
      stack.push(s)
    }
  }
  return out
}

/**
 * The one re-date path: given the main event's next text, return the writes for it and for every opted-in
 * sub-event (transitively), each shifted by its main's change at its own precision. `approx` and every
 * other key stay as they are. Cycles are cut: no file is written twice.
 */
export function cascadeRedate(ix: LinkIndex, path: string, next: string): BeatWrite[] {
  const before = ix.notes.get(path)?.text
  if (before === undefined) return [{ path, text: next, before: next }]
  const writes: BeatWrite[] = next === before ? [] : [{ path, text: next, before }]
  const from = dateFields(ix.notes.get(path)!.fm.data)
  const to = dateFields(readFrontmatter(next).data)
  if (!from || !to || minuteIndex(from) === minuteIndex(to) && from.year === to.year) return writes
  const byId = new Map(ix.beats.map((b) => [b.id, b]))
  const seen = new Set([path])
  const queue: [string, DateFields, DateFields][] = [[path, from, to]]
  while (queue.length) {
    const [id, f, t] = queue.shift()!
    for (const s of byId.get(id)?.subs ?? []) {
      const sb = byId.get(s)
      const note = ix.notes.get(s)
      if (seen.has(s) || !sb?.follows || !note) continue
      seen.add(s)
      const data = note.fm.data
      const start = dateFields(data)
      if (!start) continue
      const nStart = shiftFields(start, f, t)
      let text = patchDate(note.text, data, nStart, 'start')
      const end = dateFields(data, 'end')
      if (end) text = patchDate(text, data, shiftFields(end, f, t), 'end')
      if (text !== note.text) writes.push({ path: s, text, before: note.text })
      queue.push([s, start, nStart])
    }
  }
  return writes
}

/** Writes that unlink every sub-event of `path` (used when the main event is deleted). */
export function unlinkSubs(ix: LinkIndex, path: string): BeatWrite[] {
  const b = ix.beats.find((x) => x.id === path)
  return (b?.subs ?? []).flatMap((s) => {
    const text = ix.notes.get(s)?.text
    if (text === undefined) return []
    return [{ path: s, text: patchFrontmatterMany(text, { main_event: undefined, follows_main: undefined }), before: text }]
  })
}

/** The quoted-wikilink value for `main_event` pointing at a beat file (its file name, which may differ from its title). */
export const beatLink = (path: string) => `[[${path.split('/').pop()!.replace(/\.md$/i, '')}]]`

/** "+3 days", "−2 years", "+5 h 30 min", "same time" for a sub-event's offset from its main (in standard days). */
export function formatOffset(delta: number): string {
  const sign = delta < 0 ? '−' : '+'
  let m = Math.round(Math.abs(delta) * MIN_PER_DAY)
  if (m === 0) return 'same time'
  const parts: string[] = []
  const years = Math.floor(m / (DPY * MIN_PER_DAY))
  m -= years * DPY * MIN_PER_DAY
  const days = Math.floor(m / MIN_PER_DAY)
  m -= days * MIN_PER_DAY
  const h = Math.floor(m / 60), min = m % 60
  const pl = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`
  if (years) parts.push(pl(years, 'year'))
  if (days) parts.push(pl(days, 'day'))
  if (!years && h) parts.push(`${h} h`)
  if (!years && !days && min) parts.push(`${min} min`)
  return sign + parts.slice(0, 2).join(' ')
}
