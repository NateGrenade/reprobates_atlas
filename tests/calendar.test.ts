import { describe, it, expect } from 'vitest'
import { resolveCalendar, toCal, fromCal, keyToStored, storedToKey, formatCal, parseCalDate } from '../core/calendar'
import { parseConfig, formatWhen, parseWhen } from '../core/config'
import { VaultIndex } from '../core/vault'
import { validateVault } from '../core/validate'
import { vault } from './helpers'

const ALT = `
epoch_label: "Book 1 begins"
active_calendar: aurelian
calendars:
  - slug: aurelian
    name: Aurelian Reckoning
    year_zero_offset: 1200
    before_label: BE
    after_label: AE
    months:
      - { name: Frostmoon, days: 30 }
      - { name: Thaw, days: 30 }
      - { name: Seedfall, days: 30 }
      - { name: Bloom, days: 30 }
      - { name: Highsun, days: 30 }
      - { name: Ember, days: 30 }
      - { name: Harvest, days: 30 }
      - { name: Rot, days: 30 }
      - { name: Ash, days: 30 }
      - { name: Hollow, days: 30 }
    weekdays: [Oneday, Twoday, Threeday, Fourday, Fiveday]
    hours_per_day: 20
  - slug: concord
    name: Concord Count
    epoch_day_offset: 100
    months:
      - { name: First, days: 200 }
      - { name: Second, days: 200 }
`

describe('calendars (display conversions over standard stored time)', () => {
  it('with no calendars, the old story-year display is kept and storage is standard', () => {
    const cfg = parseConfig('epoch_label: "Book 1 begins"\ndays_per_year: 300\n')
    expect(cfg.days_per_year).toBe(365) // the old key no longer affects storage
    expect(formatWhen(cfg, { year: 0, day: 12 })).toBe('Year 0 (Book 1 begins), day 12')
    expect(formatWhen(cfg, { year: -8 })).toBe('8 years before')
    expect(toCal(cfg.resolved.active, 31)).toMatchObject({ year: 0, month: 1, day: 1 }) // 1 February
  })

  it('a 10x30-day, 20-hour calendar round-trips against stored values', () => {
    const cfg = parseConfig(ALT)
    const c = cfg.resolved.active
    expect(c.daysPerYear).toBe(300)
    expect(c.hoursPerDay).toBe(20)
    // stored day 2 00:00 = 1,440 minutes after the epoch = 1 aurelian day (1,200 min) + 240 min
    expect(toCal(c, storedToKey({ year: 0, day: 2 }))).toMatchObject({ year: 1200, month: 0, day: 2, hour: 4, minute: 0 })
    expect(formatCal(c, storedToKey({ year: 0, day: 2 }), { precision: 'minute' })).toBe('2 Frostmoon 1,200 AE 04:00')
    // calendar date -> stored -> calendar date
    const key = fromCal(c, { year: 1200, month: 1, day: 15, hour: 13, minute: 30 })
    const stored = keyToStored(key)
    expect(stored).toEqual({ year: 0, day: 38, hour: 5, minute: 30 }) // (44 days * 1200 + 13.5 * 60) min = 53,610 min = 37 days + 330 min
    expect(toCal(c, storedToKey(stored))).toMatchObject({ year: 1200, month: 1, day: 15, hour: 13, minute: 30 })
    // before the era
    expect(formatCal(c, fromCal(c, { year: -1, month: 0, day: 1 }))).toBe('1 Frostmoon 1 BE')
    expect(toCal(c, 0).weekday).toBe('Oneday')
  })

  it('a 400-day calendar with an anchor shows the same stored moment and round-trips', () => {
    const cfg = parseConfig(ALT)
    const concord = cfg.resolved.all[1]
    expect(concord.daysPerYear).toBe(400)
    const key = storedToKey({ year: 1, day: 1 }) // 365 standard days after the epoch
    expect(toCal(concord, key)).toMatchObject({ year: 1, month: 0, day: 66 }) // day 100 + 365 = 465 -> year 1, day 65 (0-based)
    expect(keyToStored(fromCal(concord, { year: 1, month: 0, day: 66 }))).toEqual({ year: 1, day: 1 })
    for (const s of [{ year: -3, day: 200, hour: 7, minute: 15 }, { year: 12, day: 1 }, { year: 0, day: 365, hour: 23, minute: 59 }]) {
      for (const cal of cfg.resolved.all) expect(keyToStored(fromCal(cal, toCal(cal, storedToKey(s))))).toEqual(s)
    }
  })

  it('anchors: which calendar date falls on the epoch', () => {
    const c = resolveCalendar({ slug: 'x', name: 'X', year_zero_offset: 500, epoch_month: 3, epoch_day: 10, epoch_hour: 6 })
    expect(toCal(c, 0)).toMatchObject({ year: 500, month: 2, day: 10, hour: 6 })
    expect(fromCal(c, { year: 500, month: 2, day: 10, hour: 6 })).toBeCloseTo(0)
  })

  it('parses calendar dates to stored values, plain forms stay story years', () => {
    const cfg = parseConfig(ALT)
    expect(parseWhen(cfg, '15 Thaw 1200 AE 13:30')).toEqual({ year: 0, day: 38, hour: 5, minute: 30 })
    expect(parseWhen(cfg, '1 Frostmoon 1200 AE')).toEqual({ year: 0, day: 1 })
    expect(parseWhen(cfg, '0 d12')).toEqual({ year: 0, day: 12 })
    expect(parseWhen(cfg, '0 d12 23:05')).toEqual({ year: 0, day: 12, hour: 23, minute: 5 })
    expect(parseWhen(cfg, '0 d366')).toBeNull()
    expect(parseWhen(cfg, '~-1000000')).toEqual({ year: -1000000, approx: true })
    expect(parseWhen(cfg, '31 Thaw 1200')).toBeNull()
    expect(parseWhen(cfg, '1 Thaw 1200 AE 20:00')).toBeNull() // 20-hour days
    expect(parseCalDate(cfg.resolved.active, '1 frost 1200')?.key).toBe(0)
  })

  it('changing calendars never invalidates stored events', () => {
    const beats = {
      'Atlas/Timeline/a.md': '---\ntype: beat\ntitle: Late\nyear: 0\nday: 320\nhour: 22\n---\n',
      'Atlas/Timeline/b.md': '---\ntype: beat\ntitle: Early\nyear: 0\nday: 5\nhour: 6\nminute: 30\n---\n'
    }
    for (const yaml of [ALT, 'calendars:\n  - {slug: tiny, name: Tiny, months: [{name: Only, days: 31}], hours_per_day: 5}\n']) {
      const files = vault({ 'Atlas/atlas.yaml': yaml, ...beats })
      expect(validateVault(files).filter((i) => i.severity === 'error')).toEqual([])
      expect(new VaultIndex(files).beats.map((b) => b.title)).toEqual(['Early', 'Late'])
    }
    const bad = vault({ 'Atlas/atlas.yaml': ALT, 'Atlas/Timeline/c.md': '---\ntype: beat\ntitle: Bad\nyear: 0\nday: 366\nhour: 24\n---\n' })
    const msgs = validateVault(bad).map((i) => `${i.file}:${i.line} ${i.message}`)
    expect(msgs.some((m) => m.startsWith('Atlas/Timeline/c.md:5') && m.includes('365'))).toBe(true)
    expect(msgs.some((m) => m.startsWith('Atlas/Timeline/c.md:6') && m.includes('hour'))).toBe(true)
  })
})

import { setConfigKeys } from '../core/configEdit'
describe('editing atlas.yaml', () => {
  it('setConfigKeys keeps other keys and comments', () => {
    const out = setConfigKeys('# settings\nepoch_label: "Book 1 begins"\neras: []\n', { active_calendar: 'a' })
    expect(out).toContain('# settings')
    expect(out).toContain('epoch_label: "Book 1 begins"')
    expect(out).toContain('active_calendar: a')
  })
})
