// Calendars (plan revision 2026-11-16, second model). Stored event times are calendar-independent, in standard
// Earth measures relative to the epoch (Book 1 begins): `year` (365 days), `day` (1-365), `hour` (0-23), `minute`.
// Inside the app a time is a "key" = standard days from the epoch (fractional for hours/minutes).
// EVERY calendar is only a display-and-entry conversion through absolute minutes from the epoch:
//   calendar minutes = key * 1440 + anchor,  calendar day = hours_per_day * 60 minutes.
// The anchor is the calendar's own date that falls on the epoch: year 0 (shown as year_zero_offset), the month,
// day and hour given by epoch_month / epoch_day / epoch_hour (defaults: first month, day 1, hour 0), plus the
// older epoch_day_offset (days). Editing a calendar can never invalidate a stored event.
// No leap years, time zones or intercalary days.

export const STANDARD_DAYS_PER_YEAR = 365
export const STANDARD_HOURS_PER_DAY = 24
const MIN_PER_DAY = 1440

export interface Month { name: string; days: number }
export interface CalendarDef {
  slug: string
  name: string
  year_zero_offset?: number
  before_label?: string
  after_label?: string
  has_year_zero?: boolean
  months?: Month[]
  weekdays?: string[]
  week_start_offset?: number
  hours_per_day?: number
  epoch_month?: number // 1-based month that contains the epoch (default 1)
  epoch_day?: number // 1-based day of that month (default 1)
  epoch_hour?: number // hour of that day (default 0)
  epoch_day_offset?: number // extra days (kept from the first calendar model)
}

export const EARTH_MONTHS: Month[] = [
  ['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30],
  ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31]
].map(([name, days]) => ({ name: name as string, days: days as number }))
export const EARTH_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** A calendar with every default filled in. */
export interface Calendar {
  slug: string
  name: string
  offset: number
  before?: string
  after?: string
  hasYearZero: boolean
  months: Month[]
  daysPerYear: number
  weekdays: string[]
  weekStart: number
  hoursPerDay: number
  /** calendar minutes at the epoch */
  anchor: number
}

export function resolveCalendar(def: Partial<CalendarDef> = {}): Calendar {
  const months = Array.isArray(def.months) && def.months.length ? def.months.map((m) => ({ name: String(m.name ?? ''), days: Math.max(1, Math.trunc(Number(m.days)) || 1) })) : EARTH_MONTHS
  const hoursPerDay = Math.max(1, Math.trunc(Number(def.hours_per_day ?? 24)) || 24)
  const em = Math.min(months.length, Math.max(1, Math.trunc(Number(def.epoch_month ?? 1)) || 1)) - 1
  const ed = Math.min(months[em].days, Math.max(1, Math.trunc(Number(def.epoch_day ?? 1)) || 1)) - 1
  const eh = Math.min(hoursPerDay - 1, Math.max(0, Math.trunc(Number(def.epoch_hour ?? 0)) || 0))
  const doy = months.slice(0, em).reduce((s, m) => s + m.days, 0) + ed + (Number(def.epoch_day_offset ?? 0) || 0)
  return {
    slug: def.slug ?? 'story',
    name: def.name ?? 'Story years',
    offset: Math.trunc(Number(def.year_zero_offset ?? 0)) || 0,
    before: def.before_label || undefined,
    after: def.after_label || undefined,
    hasYearZero: def.has_year_zero !== false,
    months,
    daysPerYear: months.reduce((s, m) => s + m.days, 0),
    weekdays: Array.isArray(def.weekdays) && def.weekdays.length ? def.weekdays.map(String) : EARTH_WEEKDAYS,
    weekStart: Math.trunc(Number(def.week_start_offset ?? 0)) || 0,
    hoursPerDay,
    anchor: (doy * hoursPerDay + eh) * 60
  }
}

/** The fixed Earth-standard measure stored values use. */
export const STANDARD = resolveCalendar({ slug: 'standard', name: 'Standard' })

/** Calendar-native fields of a key. `year` is the displayed (signed) year number. */
export interface CalDate {
  year: number
  yearIndex: number
  month: number // 0-based
  day: number // 1-based day of month
  dayOfYear: number // 1-based
  hour: number
  minute: number
  weekday: string
}

const mod = (a: number, n: number) => ((a % n) + n) % n
const EPS = 1e-6

function displayYear(cal: Calendar, idx: number) {
  const y = idx + cal.offset
  return cal.hasYearZero || y > 0 ? y : y - 1
}
function internalYear(cal: Calendar, shown: number) {
  const y = cal.hasYearZero || shown > 0 ? shown : shown + 1
  return y - cal.offset
}

/** Calendar minutes <-> key (standard days). */
export const calMinutes = (cal: Calendar, key: number) => key * MIN_PER_DAY + cal.anchor
export const keyFromCalMinutes = (cal: Calendar, m: number) => (m - cal.anchor) / MIN_PER_DAY
/** Start of calendar day number `n` (0 = the calendar day containing calendar minute 0) as a key. */
export const calDayToKey = (cal: Calendar, n: number) => keyFromCalMinutes(cal, n * cal.hoursPerDay * 60)
/** Calendar day number (fractional) of a key. */
export const keyToCalDay = (cal: Calendar, key: number) => calMinutes(cal, key) / (cal.hoursPerDay * 60)

/** key -> calendar date. */
export function toCal(cal: Calendar, key: number): CalDate {
  const totalMin = Math.round(calMinutes(cal, key) * 1e6) / 1e6
  const dayLen = cal.hoursPerDay * 60
  const dayAbs = Math.floor(totalMin / dayLen + EPS)
  let minOfDay = Math.round(totalMin - dayAbs * dayLen)
  if (minOfDay >= dayLen) minOfDay = dayLen - 1
  const yearIndex = Math.floor(dayAbs / cal.daysPerYear)
  let doy = dayAbs - yearIndex * cal.daysPerYear
  const dayOfYear = doy + 1
  let month = 0
  while (month < cal.months.length - 1 && doy >= cal.months[month].days) doy -= cal.months[month++].days
  return {
    year: displayYear(cal, yearIndex),
    yearIndex,
    month,
    day: doy + 1,
    dayOfYear,
    hour: Math.floor(minOfDay / 60),
    minute: minOfDay % 60,
    weekday: cal.weekdays[mod(dayAbs + cal.weekStart, cal.weekdays.length)]
  }
}

/** Calendar date -> key. `month` 0-based. */
export function fromCal(cal: Calendar, d: { year: number; month?: number; day?: number; hour?: number; minute?: number }): number {
  const idx = internalYear(cal, d.year)
  let doy = (d.day ?? 1) - 1
  for (let m = 0; m < (d.month ?? 0); m++) doy += cal.months[m].days
  const minutes = ((idx * cal.daysPerYear + doy) * cal.hoursPerDay + (d.hour ?? 0)) * 60 + (d.minute ?? 0)
  return keyFromCalMinutes(cal, minutes)
}

/** Stored fields (standard measure) of a key, rounded to the minute. */
export function keyToStored(key: number): { year: number; day: number; hour?: number; minute?: number } {
  const totalMin = Math.round(key * MIN_PER_DAY)
  const dayAbs = Math.floor(totalMin / MIN_PER_DAY)
  const year = Math.floor(dayAbs / STANDARD_DAYS_PER_YEAR)
  const out: { year: number; day: number; hour?: number; minute?: number } = { year, day: dayAbs - year * STANDARD_DAYS_PER_YEAR + 1 }
  const m = totalMin - dayAbs * MIN_PER_DAY
  if (m > 0) {
    out.hour = Math.floor(m / 60)
    if (m % 60) out.minute = m % 60
  }
  return out
}

/** Stored fields -> key. */
export function storedToKey(s: { year: number; day?: number; hour?: number; minute?: number }): number {
  return s.year * STANDARD_DAYS_PER_YEAR + ((s.day ?? 1) - 1) + ((s.hour ?? 0) + (s.minute ?? 0) / 60) / STANDARD_HOURS_PER_DAY
}

export function yearLabel(cal: Calendar, shown: number): string {
  const n = (x: number) => Math.abs(x).toLocaleString('en-US')
  if (cal.before || cal.after) {
    const positive = cal.hasYearZero ? shown >= 0 : shown > 0
    return positive ? `${n(shown)}${cal.after ? ' ' + cal.after : ''}` : `${n(shown)}${cal.before ? ' ' + cal.before : ' before'}`
  }
  return shown < 0 ? `−${n(shown)}` : n(shown)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Human date in a calendar. */
export function formatCal(cal: Calendar, key: number, opts: { precision?: 'year' | 'day' | 'minute'; approx?: boolean } = {}): string {
  const c = toCal(cal, key)
  const a = opts.approx ? '~' : ''
  const y = yearLabel(cal, c.year)
  if (opts.precision === 'year') return `${a}${cal.after || cal.before ? '' : 'Year '}${y}`
  const date = `${c.day} ${cal.months[c.month].name} ${y}`
  return `${a}${date}${opts.precision === 'minute' ? ` ${pad(c.hour)}:${pad(c.minute)}` : ''}`
}

/** Parse "14 Frostmoon -8", "14 Frostmoon 1200 AE", optionally followed by "13:45". Returns a key or null. */
export function parseCalDate(cal: Calendar, s: string): { key: number; hasTime: boolean; approx: boolean } | null {
  let str = s.trim()
  const approx = str.startsWith('~')
  if (approx) str = str.slice(1).trim()
  let hour: number | undefined, minute: number | undefined
  const tm = /\s+(\d{1,2}):(\d{2})$/.exec(str)
  if (tm) {
    hour = Number(tm[1])
    minute = Number(tm[2])
    str = str.slice(0, tm.index).trim()
    if (hour >= cal.hoursPerDay || minute >= 60) return null
  }
  const m = /^(\d{1,4})\s+(.+?)\s+([+−-]?[\d,]+)(?:\s+(\S+))?$/.exec(str)
  if (!m) return null
  const day = Number(m[1])
  const q = m[2].toLowerCase()
  const mi = cal.months.findIndex((x) => x.name.toLowerCase() === q)
  const mj = mi >= 0 ? mi : cal.months.findIndex((x) => x.name.toLowerCase().startsWith(q))
  if (mj < 0 || day < 1 || day > cal.months[mj].days) return null
  let year = Number(m[3].replace(/[,]/g, '').replace('−', '-'))
  if (m[4]) {
    const lab = m[4].toLowerCase()
    if (cal.before && lab === cal.before.toLowerCase()) year = -Math.abs(year)
    else if (!(cal.after && lab === cal.after.toLowerCase())) return null
  }
  return { key: fromCal(cal, { year, month: mj, day, hour, minute }), hasTime: hour !== undefined, approx }
}
