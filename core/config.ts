// Names that Nathan may rename are single constants here.
import { parse } from 'yaml'
import { formatDateHuman, parseDateInput, type StoryDate } from './dates'
import { resolveCalendar, formatCal, storedToKey, keyToStored, parseCalDate, STANDARD, STANDARD_DAYS_PER_YEAR, type Calendar, type CalendarDef } from './calendar'

export const APP_NAME = 'Reprobates Atlas'
export const ATLAS_DIR = 'Atlas'
export const PATHS = {
  readme: `${ATLAS_DIR}/README.md`,
  config: `${ATLAS_DIR}/atlas.yaml`,
  timeline: `${ATLAS_DIR}/Timeline`,
  entities: `${ATLAS_DIR}/Entities`,
  portraits: `${ATLAS_DIR}/Portraits`,
  maps: `${ATLAS_DIR}/Maps`,
  /** shared view choices (timeline lanes); contract 6b */
  view: `${ATLAS_DIR}/view.json`
}

/** Lane choice for one timeline grouping: automatic, or exactly these lanes in this order. */
export interface LanePref { auto: boolean; shown: string[] }
export interface ViewFile { lanes?: Partial<Record<'timeline' | 'character' | 'location', LanePref>>; [k: string]: unknown }

/** `Atlas/view.json`; an unreadable or missing file is an empty view (the app falls back to automatic lanes). */
export function parseView(text: string | null | undefined): ViewFile {
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export interface Era { name: string; start_year: number; end_year: number; color?: string }
export interface TimelineDef { slug: string; name: string; color?: string; description?: string }
export interface AtlasConfig {
  epoch_label: string
  days_per_year: number
  eras: Era[]
  timelines: TimelineDef[]
  calendar: unknown
  root_location?: string
  /** Custom calendars: display/entry conversions only. Empty = story years. */
  calendars: CalendarDef[]
  active_calendar?: string
  /** Resolved calendars; `active` is used for display and entry (STANDARD when none are defined) */
  resolved: { active: Calendar; all: Calendar[] }
}

export const DEFAULT_CONFIG: AtlasConfig = {
  epoch_label: 'Book 1 begins',
  days_per_year: STANDARD_DAYS_PER_YEAR,
  eras: [],
  timelines: [],
  calendar: null,
  calendars: [],
  resolved: { active: STANDARD, all: [] }
}

export function parseConfig(text: string | undefined): AtlasConfig {
  if (!text) return { ...DEFAULT_CONFIG }
  const raw = (parse(text) ?? {}) as Partial<AtlasConfig>
  const calendars = Array.isArray(raw.calendars) ? raw.calendars.filter((c) => c && typeof c === 'object') : []
  const all = calendars.map((c) => resolveCalendar(c))
  const active = all.find((c) => c.slug === raw.active_calendar) ?? all[0] ?? STANDARD
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // stored times always use standard measures; atlas.yaml's days_per_year no longer affects storage
    days_per_year: STANDARD_DAYS_PER_YEAR,
    eras: Array.isArray(raw.eras) ? raw.eras : [],
    timelines: Array.isArray(raw.timelines) ? raw.timelines : [],
    calendars,
    resolved: { active, all }
  }
}

/** A stored date (beat fields) as text in the active calendar; with no calendars defined, the story-year form. */
export function formatWhen(cfg: AtlasConfig, d: StoryDate & { hour?: number; minute?: number }): string {
  const time = d.hour !== undefined ? ` ${String(d.hour).padStart(2, '0')}:${String(d.minute ?? 0).padStart(2, '0')}` : ''
  if (!cfg.calendars.length) return formatDateHuman(d, cfg.epoch_label) + time
  const key = storedToKey(d)
  return formatCal(cfg.resolved.active, key, { precision: d.day === undefined ? 'year' : d.hour !== undefined ? 'minute' : 'day', approx: d.approx })
}

/** A raw key (e.g. the time cursor) as text in the active calendar. */
export function formatKey(cfg: AtlasConfig, key: number, withTime = false): string {
  if (!cfg.calendars.length) {
    const year = Math.floor(key / cfg.days_per_year)
    const day = Math.floor(key - year * cfg.days_per_year) + 1
    const frac = key - Math.floor(key)
    const hm = withTime && frac > 1e-6 ? (() => { const h = frac * 24; return ` ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}` })() : ''
    return formatDateHuman({ year, day }, cfg.epoch_label) + hm
  }
  return formatCal(cfg.resolved.active, key, { precision: withTime ? 'minute' : 'day' })
}

export interface WhenFields { year: number; day?: number; hour?: number; minute?: number; approx?: boolean }

/**
 * Parse a typed date. Story forms (canonical stored years): "-8", "0 d12", "~-1000000", "0 d12 13:45".
 * Calendar form in the active calendar: "14 Frostmoon -8", "14 Frostmoon 1200 AE 13:45".
 */
export function parseWhen(cfg: AtlasConfig, s: string): WhenFields | null {
  const str = s.trim()
  const tm = /^(.*\bd\d+)\s+(\d{1,2}):(\d{2})$/.exec(str)
  const base = parseDateInput(tm ? tm[1] : str)
  if (base) {
    if (base.day !== undefined && base.day > cfg.days_per_year) return null
    const out: WhenFields = { ...base }
    if (tm) {
      const h = Number(tm[2]), m = Number(tm[3])
      if (h >= 24 || m >= 60) return null
      out.hour = h
      if (m) out.minute = m
    }
    return out
  }
  const c = parseCalDate(cfg.resolved.active, str)
  if (!c) return null
  const stored = keyToStored(c.key)
  const out: WhenFields = { year: stored.year, day: stored.day }
  if (c.hasTime) {
    out.hour = stored.hour ?? 0
    if (stored.minute) out.minute = stored.minute
  }
  if (c.approx) out.approx = true
  return out
}
