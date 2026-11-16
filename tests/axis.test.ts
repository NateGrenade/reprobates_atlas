import { describe, it, expect } from 'vitest'
import { ticks, snap } from '../src/renderer/src/timeline/axis'
import { parseConfig } from '../core/config'

const CAL = `calendars:\n  - slug: a\n    name: A\n    year_zero_offset: 1200\n    after_label: AE\n    before_label: BE\n    months: [{name: Frostmoon, days: 30}, {name: Thaw, days: 30}, {name: Seedfall, days: 30}, {name: Bloom, days: 30}, {name: Highsun, days: 30}, {name: Ember, days: 30}, {name: Harvest, days: 30}, {name: Rot, days: 30}, {name: Ash, days: 30}, {name: Hollow, days: 30}]\n    hours_per_day: 20\n`

describe('timeline axis in a calendar', () => {
  const cfg = parseConfig(CAL)
  it('years, months, days and hours as you zoom in', () => {
    const at = (ppd: number) => ticks({ center: 150, ppd, width: 1000 }, cfg)
    expect(at(0.05).ticks.map((t) => t.label)).toContain('1,200 AE')
    const months = at(5).ticks.map((t) => t.label)
    expect(months).toEqual(expect.arrayContaining(['Highsun', 'Ember']))
    const days = at(60).ticks.map((t) => t.label)
    expect(days.some((l) => /^[A-Z][a-z]+ 1,200 AE$/.test(l))).toBe(true)
    const hours = ticks({ center: 150, ppd: 600, width: 1000 }, cfg).ticks.map((t) => t.label)
    const hh = hours.filter((l) => /^\d\d:00$/.test(l)).map((l) => Number(l.slice(0, 2)))
    expect(hh.length).toBeGreaterThan(3)
    expect(Math.max(...hh)).toBeLessThan(20) // 20-hour days
    expect(hours.some((l) => /^\d+ [A-Z][a-z]+ 1,200 AE$/.test(l))).toBe(true) // day boundaries labelled
  })
  it('without calendars, the old story-year axis is unchanged', () => {
    const legacy = parseConfig('epoch_label: x\n')
    expect(ticks({ center: 0, ppd: 0.05, width: 1000 }, legacy).ticks.map((t) => t.label)).toContain('0')
    expect(ticks({ center: 0, ppd: 20, width: 1000 }, legacy).ticks.map((t) => t.label)).toContain('Year 0')
  })
  it('snaps to whole hours of the active calendar when zoomed far in', () => {
    expect(snap(44.5, 400)).toEqual({ year: 0, day: 45, hour: 12 })
    expect(snap(44.5, 10)).toEqual({ year: 0, day: 46 })
    // 20-hour calendar: calendar hours are 72 standard minutes; result is stored in standard measure
    const s = snap(1.03, 400, cfg.resolved.active)
    expect(s).toEqual({ year: 0, day: 2, hour: 1 }) // 1,483 min rounds to 1,500 = 25 calendar hours since the anchor
  })
})
