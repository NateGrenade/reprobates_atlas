import type { AtlasConfig } from '@core/config'
import { formatCal, toCal, yearLabel, calDayToKey, keyToCalDay, calMinutes, keyFromCalMinutes, keyToStored, STANDARD, type Calendar } from '@core/calendar'
// Timeline axis maths. Positions are linear in sort-key days; zoom spans ~10^-9 to 80 px/day, so a single view can
// hold a billion years or a few days. The minimap uses a signed-log scale so the whole history is always visible.

export const MIN_PPD = 1e-10
export const MAX_PPD = 2400 // about 100 px per hour

export interface Viewport {
  center: number // sort key at the horizontal centre
  ppd: number // pixels per day
  width: number
}

export const keyToX = (v: Viewport, k: number) => (k - v.center) * v.ppd + v.width / 2
export const xToKey = (v: Viewport, x: number) => v.center + (x - v.width / 2) / v.ppd

export function zoomAt(v: Viewport, x: number, factor: number): Viewport {
  const ppd = Math.min(MAX_PPD, Math.max(MIN_PPD, v.ppd * factor))
  const k = xToKey(v, x)
  // keep the key under the cursor fixed
  return { ...v, ppd, center: k - (x - v.width / 2) / ppd }
}

const YEAR_STEPS = [1, 2, 5]
export interface Tick {
  key: number
  label: string
  major: boolean
}

export function fmtYear(y: number): string {
  const a = Math.abs(y)
  const s = a >= 1e9 ? `${+(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${+(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${+(a / 1e3).toFixed(1)}k` : a.toLocaleString('en-US')
  return y < 0 ? `−${s}` : y > 0 ? `+${s}` : '0'
}

/** Ticks for the visible range in the active calendar (story years / day numbers when no calendar is defined). */
export function ticks(v: Viewport, cfg: AtlasConfig, minPx = 96): { ticks: Tick[]; unit: string } {
  const legacy = !cfg.calendars.length
  const cal = cfg.resolved.active
  const k0 = xToKey(v, -50), k1 = xToKey(v, v.width + 50)
  const out: Tick[] = []
  const dayKeys = cal.hoursPerDay / 24 // one calendar day, in standard days
  const yearLab = (k: number) => (legacy ? `Year ${fmtYear(toCal(cal, k).year)}` : yearLabel(cal, toCal(cal, k).year))
  // hours
  const hourStep = [1, 2, 3, 4, 6, 12].find((h) => h < cal.hoursPerDay && (h / 24) * v.ppd >= minPx)
  if (hourStep) {
    for (let n = Math.floor(keyToCalDay(cal, k0)); calDayToKey(cal, n) <= k1 && out.length < 600; n++)
      for (let h = 0; h < cal.hoursPerDay; h += hourStep) {
        const k = calDayToKey(cal, n) + h / 24
        if (k < k0 || k > k1) continue
        const c = toCal(cal, k)
        out.push({ key: k, label: h === 0 ? (legacy ? (c.dayOfYear === 1 ? yearLab(k) : `d${c.dayOfYear}`) : formatCal(cal, k)) : `${String(h).padStart(2, '0')}:00`, major: h === 0 })
      }
    return { ticks: out, unit: hourStep === 1 ? 'hours' : `${hourStep} hours` }
  }
  // days
  const dayStep = [1, 2, 5, 10, 20, 50, 100, 200].find((d) => d * dayKeys * v.ppd >= minPx && d < cal.daysPerYear)
  if (dayStep && (legacy || dayStep <= 10)) {
    for (let n = Math.floor(keyToCalDay(cal, k0)); calDayToKey(cal, n) <= k1 && out.length < 400; n++) {
      const k = calDayToKey(cal, n)
      const c = toCal(cal, k)
      if (legacy) {
        if (c.dayOfYear === 1) out.push({ key: k, label: yearLab(k), major: true })
        else if ((c.dayOfYear - 1) % dayStep === 0) out.push({ key: k, label: `d${c.dayOfYear}`, major: false })
      } else if (c.day === 1) out.push({ key: k, label: `${cal.months[c.month].name} ${yearLabel(cal, c.year)}`, major: true })
      else if ((c.day - 1) % dayStep === 0 && cal.months[c.month].days - c.day >= dayStep / 2) out.push({ key: k, label: String(c.day), major: false })
    }
    return { ticks: out, unit: 'days' }
  }
  const yearKeys = cal.daysPerYear * dayKeys
  // months
  if (!legacy) {
    const avg = yearKeys / cal.months.length
    const mStep = [1, 2, 3, 6].find((m) => m < cal.months.length && avg * m * v.ppd >= minPx)
    if (mStep) {
      const y0 = Math.floor(keyToCalDay(cal, k0) / cal.daysPerYear), y1 = Math.ceil(keyToCalDay(cal, k1) / cal.daysPerYear)
      for (let yi = y0; yi <= y1 && out.length < 400; yi++) {
        let doy = 0
        cal.months.forEach((m, mi) => {
          const k = calDayToKey(cal, yi * cal.daysPerYear + doy)
          doy += m.days
          if (mi % mStep !== 0 || k < k0 || k > k1) return
          out.push({ key: k, label: mi === 0 ? yearLabel(cal, toCal(cal, k).year) : m.name, major: mi === 0 })
        })
      }
      return { ticks: out, unit: mStep === 1 ? 'months' : `${mStep} months` }
    }
  }
  // years (aligned to round displayed year numbers)
  let stepY = 1
  outer: for (let p = 1; p <= 1e10; p *= 10) for (const m of YEAR_STEPS) if (m * p * yearKeys * v.ppd >= minPx) { stepY = m * p; break outer }
  const shift = legacy ? 0 : cal.offset
  const yStart = Math.floor((keyToCalDay(cal, k0) / cal.daysPerYear + shift) / stepY) * stepY
  for (let y = yStart; out.length < 400; y += stepY) {
    const k = calDayToKey(cal, (y - shift) * cal.daysPerYear)
    if (k > k1) break
    out.push({ key: k, label: legacy ? fmtYear(y) : yearLabel(cal, toCal(cal, k).year), major: y % (stepY * 5) === 0 })
  }
  return { ticks: out, unit: stepY === 1 ? 'years' : `${fmtYear(stepY).replace('+', '')} years` }
}

// ---- minimap: signed log of years from the epoch
export const mm = (k: number, dpy: number) => Math.sign(k) * Math.log10(1 + Math.abs(k) / dpy)
export const mmInv = (m: number, dpy: number) => Math.sign(m) * (Math.pow(10, Math.abs(m)) - 1) * dpy

/** Snap to whole hours (far in), days, or years (far out) of the given calendar; returns stored fields. */
export function snap(k: number, ppd: number, cal: Calendar = STANDARD): { year: number; day?: number; hour?: number; minute?: number } {
  const dayKeys = cal.hoursPerDay / 24
  if (ppd / 24 >= 6) {
    const m = calMinutes(cal, k)
    return keyToStored(keyFromCalMinutes(cal, Math.round(m / 60) * 60))
  }
  if (ppd * dayKeys >= 1.5) {
    // a calendar day may start part-way through a standard day, so the stored time can carry hours
    return keyToStored(calDayToKey(cal, Math.round(keyToCalDay(cal, k))))
  }
  // whole calendar years
  const yi = Math.round(keyToCalDay(cal, k) / cal.daysPerYear)
  const s = keyToStored(calDayToKey(cal, yi * cal.daysPerYear))
  return cal === STANDARD || (s.day === 1 && s.hour === undefined) ? { year: s.year } : s
}
