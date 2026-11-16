// Story-relative dates (contract 4). Year 0 starts on Book 1's first day; there is a year 0.

export interface StoryDate {
  year: number
  day?: number
  approx?: boolean
}

export const DEFAULT_DAYS_PER_YEAR = 365
export const MAX_ABS_YEAR = 1e10

/** Sort key = year * days_per_year + (day - 1). A beat without a day sorts at the start of its year. */
export function sortKey(year: number, day: number | undefined, daysPerYear = DEFAULT_DAYS_PER_YEAR): number {
  return year * daysPerYear + ((day ?? 1) - 1)
}

/** Parse '-8', '0 d12', '~-1000000', '-1,000,000', '12 d3'. Returns null if unreadable. */
export function parseDateInput(s: string): StoryDate | null {
  const m = /^\s*(~)?\s*([+-]?[\d,_ ]*\d)\s*(?:d\s*(\d+))?\s*$/i.exec(s)
  if (!m) return null
  const year = Number(m[2].replace(/[,_ ]/g, ''))
  if (!Number.isSafeInteger(year)) return null
  const out: StoryDate = { year }
  if (m[3]) out.day = Number(m[3])
  if (m[1]) out.approx = true
  return out
}

export function formatDateInput(d: StoryDate): string {
  return `${d.approx ? '~' : ''}${d.year}${d.day ? ` d${d.day}` : ''}`
}

/** Human label: 'Year 0, day 12', '8 years before', '~1,000,000 years before'. */
export function formatDateHuman(d: StoryDate, epochLabel = 'Book 1 begins'): string {
  const a = d.approx ? '~' : ''
  const n = (x: number) => Math.abs(x).toLocaleString('en-US')
  let s: string
  if (d.year === 0) s = `Year 0 (${epochLabel})`
  else if (d.year < 0) s = `${a}${n(d.year)} year${Math.abs(d.year) === 1 ? '' : 's'} before`
  else s = `${a}Year ${n(d.year)}`
  if (d.year === 0 && a) s = '~' + s
  if (d.day) s += `, day ${d.day}`
  return s
}
