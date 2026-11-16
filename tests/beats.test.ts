import { describe, it, expect } from 'vitest'
import { beatPath, newBeatText, redate } from '../core/beats'
import { readFrontmatter } from '../core/note'
import { changedLines } from './helpers'

describe('beat files', () => {
  it('names files from the title and avoids clashes', () => {
    const have = new Set(['Atlas/Timeline/Elion enters the Capital.md'])
    expect(beatPath('Elion enters the Capital', (p) => have.has(p))).toBe('Atlas/Timeline/Elion enters the Capital 2.md')
    expect(beatPath('A/B: c?', () => false)).toBe('Atlas/Timeline/A B c.md')
  })
  it('writes a valid beat', () => {
    const t = newBeatText({ title: 'Elion enters the Capital', date: { year: 0, day: 12 }, characters: ['[[Elion]]'], location: '[[Demo Capital]]', move: 'arrive' })
    expect(readFrontmatter(t).data).toMatchObject({ type: 'beat', title: 'Elion enters the Capital', year: 0, day: 12, characters: ['[[Elion]]'], location: '[[Demo Capital]]', move: 'arrive' })
  })
  it('re-dating changes only the year/day lines', () => {
    const t = newBeatText({ title: 'X', date: { year: 0, day: 12 }, characters: ['[[Elion]]'] })
    expect(changedLines(t, redate(t, { year: 0, day: 14 }))).toEqual({ removed: ['day: 12'], added: ['day: 14'] })
    const y = redate(t, { year: -3, day: 12 })
    expect(changedLines(t, y)).toEqual({ removed: ['year: 0'], added: ['year: -3'] })
    expect(readFrontmatter(redate(t, { year: 2 })).data.day).toBeUndefined()
  })
})
