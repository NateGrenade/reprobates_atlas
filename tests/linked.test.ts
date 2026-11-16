import { describe, it, expect } from 'vitest'
import { cascadeRedate, followerIds, formatOffset, redate, shiftFields, unlinkSubs } from '../core/beats'
import { VaultIndex } from '../core/vault'
import { validateVault } from '../core/validate'
import { readFrontmatter } from '../core/note'
import { changedLines, vault } from './helpers'

const T = 'Atlas/Timeline/'
const beat = (title: string, extra: string) => `---\ntype: beat\ntitle: ${title}\n${extra}\n---\nBody of ${title}.\n`

describe('shiftFields keeps each sub-event at its own precision', () => {
  const from = { year: 0, day: 10 }, to = { year: 0, day: 13 }
  it('day subs move by the change in days', () => {
    expect(shiftFields({ year: 0, day: 20 }, from, to)).toEqual({ year: 0, day: 23 })
    expect(shiftFields({ year: 0, day: 364 }, from, to)).toEqual({ year: 1, day: 2 })
    expect(shiftFields({ year: 0, day: 2 }, to, from)).toEqual({ year: -1, day: 364 })
  })
  it('timed subs move by the exact minutes, crossing midnight and keeping hour 0', () => {
    const f = { year: 0, day: 10, hour: 20, minute: 0 }, t = { year: 0, day: 10, hour: 23, minute: 30 }
    expect(shiftFields({ year: 0, day: 12, hour: 22, minute: 15 }, f, t)).toEqual({ year: 0, day: 13, hour: 1, minute: 45 })
    expect(shiftFields({ year: 0, day: 12, hour: 20, minute: 30 }, f, t)).toEqual({ year: 0, day: 13, hour: 0, minute: 0 })
    // a day-precision main moving 3 days moves a timed sub exactly 3 days
    expect(shiftFields({ year: 0, day: 12, hour: 8 }, from, to)).toEqual({ year: 0, day: 15, hour: 8, minute: 0 })
  })
  it('day subs ignore sub-day moves of a timed main (rounded to the day number change)', () => {
    expect(shiftFields({ year: 0, day: 30 }, { year: 0, day: 10, hour: 9 }, { year: 0, day: 10, hour: 18 })).toEqual({ year: 0, day: 30 })
    expect(shiftFields({ year: 0, day: 30 }, { year: 0, day: 10, hour: 22 }, { year: 0, day: 11, hour: 2 })).toEqual({ year: 0, day: 31 })
  })
  it('year-only subs move by the change in the main year number, so whole-year moves are exact', () => {
    expect(shiftFields({ year: -8 }, { year: 0 }, { year: 3 })).toEqual({ year: -5 })
    expect(shiftFields({ year: -8 }, { year: 0, day: 10 }, { year: 0, day: 200 })).toEqual({ year: -8 })
    expect(shiftFields({ year: -8 }, { year: 0, day: 360 }, { year: 1, day: 5 })).toEqual({ year: -7 })
  })
  it('moving back restores exactly (no drift)', () => {
    const subs = [{ year: 2 }, { year: 0, day: 50 }, { year: 0, day: 50, hour: 3, minute: 7 }]
    const a = { year: 0, day: 10, hour: 4 }, b = { year: 1, day: 300, hour: 17, minute: 45 }
    for (const s of subs) expect(shiftFields(shiftFields(s, a, b), b, a)).toEqual({ ...s, ...(s.hour !== undefined ? { minute: s.minute ?? 0 } : {}) })
  })
})

describe('cascadeRedate', () => {
  const files = () =>
    vault({
      [T + 'A.md']: beat('A', 'year: 0\nday: 10'),
      [T + 'B.md']: beat('B', 'year: 0\nday: 13\napprox: true\nend_year: 0\nend_day: 20\nmain_event: "[[A]]"\nfollows_main: true'),
      [T + 'C.md']: beat('C', 'year: 0\nday: 15\nmain_event: "[[A]]"'),
      [T + 'D.md']: beat('D', 'year: 0\nday: 14\nhour: 6\nmain_event: "[[B]]"\nfollows_main: true'),
      [T + 'E.md']: beat('E', 'year: 2\nmain_event: "[[A]]"\nfollows_main: true')
    })
  it('indexes main and subs', () => {
    const ix = new VaultIndex(files())
    expect(ix.beat(T + 'B.md')!.main).toBe(T + 'A.md')
    expect(ix.beat(T + 'A.md')!.subs.sort()).toEqual([T + 'B.md', T + 'C.md', T + 'E.md'])
    expect(followerIds(ix, T + 'A.md').sort()).toEqual([T + 'B.md', T + 'D.md', T + 'E.md'])
  })
  it('shifts opted-in subs (start and end, transitively), leaves the others byte-identical', () => {
    const f = files()
    const ix = new VaultIndex(f)
    const a = f.get(T + 'A.md') as string
    const ws = cascadeRedate(ix, T + 'A.md', redate(a, { year: 0, day: 17 }))
    const by = Object.fromEntries(ws.map((w) => [w.path.slice(T.length), w.text]))
    expect(Object.keys(by).sort()).toEqual(['A.md', 'B.md', 'D.md'])
    expect(readFrontmatter(by['B.md']).data).toMatchObject({ day: 20, end_day: 27, approx: true, follows_main: true })
    const ol = (f.get(T + 'B.md') as string).split('\n'), nl = by['B.md'].split('\n')
    expect(nl.length).toBe(ol.length)
    expect(ol.filter((l, i) => l !== nl[i])).toEqual(['day: 13', 'end_day: 20'])
    expect(readFrontmatter(by['D.md']).data).toMatchObject({ day: 21, hour: 6 })
    // year-only E: a 7-day move does not change its year
    expect(by['E.md']).toBeUndefined()
    // before texts are kept for one-step undo
    expect(ws.find((w) => w.path === T + 'B.md')!.before).toBe(f.get(T + 'B.md'))
  })
  it('a whole-year move shifts a year-only sub', () => {
    const f = files()
    const ws = cascadeRedate(new VaultIndex(f), T + 'A.md', redate(f.get(T + 'A.md') as string, { year: 3, day: 10 }))
    expect(readFrontmatter(ws.find((w) => w.path === T + 'E.md')!.text).data.year).toBe(5)
  })
  it('survives a cycle', () => {
    const f = vault({ [T + 'X.md']: beat('X', 'year: 0\nday: 1\nmain_event: "[[Y]]"\nfollows_main: true'), [T + 'Y.md']: beat('Y', 'year: 0\nday: 5\nmain_event: "[[X]]"\nfollows_main: true') })
    const ws = cascadeRedate(new VaultIndex(f), T + 'X.md', redate(f.get(T + 'X.md') as string, { year: 0, day: 2 }))
    expect(ws.map((w) => w.path).sort()).toEqual([T + 'X.md', T + 'Y.md'])
    expect(readFrontmatter(ws[1].text).data.day).toBe(6)
  })
  it('unlinkSubs removes only the two link keys', () => {
    const f = files()
    const ws = unlinkSubs(new VaultIndex(f), T + 'A.md')
    expect(ws).toHaveLength(3)
    const b = ws.find((w) => w.path === T + 'B.md')!
    expect(changedLines(b.before, b.text)).toEqual({ removed: ['main_event: "[[A]]"', 'follows_main: true'], added: [] })
  })
  it('formats offsets', () => {
    expect(formatOffset(3)).toBe('+3 days')
    expect(formatOffset(-1)).toBe('−1 day')
    expect(formatOffset(365 * 2 + 4)).toBe('+2 years 4 days')
    expect(formatOffset(5.5 / 24)).toBe('+5 h 30 min')
    expect(formatOffset(0)).toBe('same time')
  })
})

describe('validate linked events', () => {
  it('main_event must resolve to a beat, no cycles, follows_main alone warns', () => {
    const issues = validateVault(
      vault({
        'Characters/Elion.md': '---\ntype: character\n---\n',
        [T + 'A.md']: beat('A', 'year: 0\nmain_event: "[[Nobody]]"'),
        [T + 'B.md']: beat('B', 'year: 0\nmain_event: "[[Elion]]"'),
        [T + 'C.md']: beat('C', 'year: 0\nmain_event: "[[D]]"'),
        [T + 'D.md']: beat('D', 'year: 0\nmain_event: "[[C]]"'),
        [T + 'E.md']: beat('E', 'year: 0\nfollows_main: true'),
        [T + 'F.md']: beat('F', 'year: 0\nmain_event: "[[A]]"\nfollows_main: yes please'),
        [T + 'G.md']: beat('G', 'year: 0\nmain_event: "[[G]]"')
      })
    ).map((i) => `${i.file.slice(T.length)} ${i.severity} ${i.message}`)
    expect(issues).toContain('A.md error [[Nobody]] does not match any note')
    expect(issues.some((i) => i.startsWith('B.md error') && i.includes('is not an event'))).toBe(true)
    expect(issues).toContain('C.md error Main event cycle: C -> D -> C')
    expect(issues).toContain('D.md error Main event cycle: D -> C -> D')
    expect(issues).toContain("E.md warning 'follows_main' has no effect without 'main_event'")
    expect(issues).toContain("F.md error 'follows_main' must be true or false")
    expect(issues).toContain('G.md error An event cannot be its own main event')
  })
})

describe('CLI/MCP set re-dates with followers', () => {
  it('atlas set <beat> day N moves followers too', async () => {
    const { setKeyWrites } = await import('../core/ops')
    const f = vault({ [T + 'A.md']: beat('A', 'year: 0\nday: 10'), [T + 'B.md']: beat('B', 'year: 0\nday: 12\nmain_event: "[[A]]"\nfollows_main: true') })
    const ws = setKeyWrites(f, T + 'A.md', 'day', 20)
    expect(ws.map((w) => w.path)).toEqual([T + 'A.md', T + 'B.md'])
    expect(readFrontmatter(ws[1].text).data.day).toBe(22)
    expect(setKeyWrites(f, T + 'A.md', 'status', 'canon')).toHaveLength(1)
  })
})
