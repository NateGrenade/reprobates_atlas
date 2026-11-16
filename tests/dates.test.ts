import { describe, it, expect } from 'vitest'
import { sortKey, parseDateInput, formatDateInput } from '../core/dates'
import { VaultIndex } from '../core/vault'
import { vault } from './helpers'

const beat = (title: string, extra: string) => `---\ntype: beat\ntitle: ${title}\n${extra}\n---\n`

describe('story dates', () => {
  it('beats at -1000000, -8, 0, 0 d12 sort correctly', () => {
    const ix = new VaultIndex(
      vault({
        'Atlas/Timeline/d.md': beat('Day twelve', 'year: 0\nday: 12'),
        'Atlas/Timeline/b.md': beat('Eight before', 'year: -8'),
        'Atlas/Timeline/a.md': beat('Ancient', 'year: -1000000\napprox: true'),
        'Atlas/Timeline/c.md': beat('Book 1 begins', 'year: 0'),
        'Atlas/Timeline/e.md': beat('Late in -8', 'year: -8\nday: 365'),
        'Atlas/Timeline/f2.md': beat('Same day second', 'year: 0\nday: 12\norder: 2'),
        'Atlas/Timeline/f1.md': beat('Same day first', 'year: 0\nday: 12\norder: 1')
      })
    )
    expect(ix.beats.map((b) => b.title)).toEqual(['Ancient', 'Eight before', 'Late in -8', 'Book 1 begins', 'Day twelve', 'Same day first', 'Same day second'])
  })

  it('sort key arithmetic stays exact at ±10^9 years', () => {
    expect(sortKey(-1e9, 1)).toBe(-365e9)
    expect(sortKey(1e9, 365) - sortKey(1e9, 364)).toBe(1)
    expect(sortKey(0, 1)).toBe(0)
    expect(sortKey(-1, 365)).toBe(-1)
  })

  it('parses the inline date field', () => {
    expect(parseDateInput('-8')).toEqual({ year: -8 })
    expect(parseDateInput('0 d12')).toEqual({ year: 0, day: 12 })
    expect(parseDateInput('~-1000000')).toEqual({ year: -1000000, approx: true })
    expect(parseDateInput('-1,000,000')).toEqual({ year: -1000000 })
    expect(parseDateInput('soon')).toBeNull()
    expect(formatDateInput({ year: -3, day: 4, approx: true })).toBe('~-3 d4')
  })
})
