import { describe, it, expect } from 'vitest'
import { VaultIndex } from '../core/vault'
import { timelineBeats, positionAt, whoIsHere } from '../core/timeline'
import { sortKey } from '../core/dates'
import { vault } from './helpers'

const loc = (parent?: string) => `---\ntype: location\n${parent ? `parent: "[[${parent}]]"\n` : ''}---\n`
const beat = (title: string, y: string, extra = '') => `---\ntype: beat\ntitle: ${title}\n${y}\ncharacters: ["[[Elion]]"]\n${extra}---\n`

const ix = new VaultIndex(
  vault({
    'Atlas/atlas.yaml': 'timelines: [{slug: book-1, name: Book 1}]\n',
    'Characters/Elion.md': '---\ntype: character\n---\n',
    'Characters/Soren.md': '---\ntype: character\n---\n',
    'World/Aurelia.md': loc(),
    'W/Capital.md': loc('Aurelia'),
    'W/Palace.md': loc('Capital'),
    'W/Port.md': loc('Aurelia'),
    'Atlas/Timeline/1.md': beat('Born', 'year: -20', 'location: "[[Port]]"\n'),
    'Atlas/Timeline/2.md': beat('Leaves port', 'year: 0\nday: 5', 'location: "[[Port]]"\nmove: depart\ntimelines: [book-1]\n'),
    'Atlas/Timeline/3.md': beat('Enters capital', 'year: 0\nday: 12', 'location: "[[Capital]]"\nmove: arrive\n'),
    'Atlas/Timeline/4.md': beat('Audience', 'year: 0\nday: 20', 'location: "[[Palace]]"\n'),
    'Atlas/Timeline/5.md': beat('Thinks', 'year: 0\nday: 21'),
    'Atlas/Timeline/6.md': beat('Leaves capital', 'year: 0\nday: 30', 'location: "[[Capital]]"\nmove: depart\n'),
    'Atlas/Timeline/7.md': '---\ntype: beat\ntitle: Soren elsewhere\nyear: 0\nday: 30\ncharacters: ["[[Soren]]"]\nlocation: "[[Palace]]"\norder: 2\nmove: stay\n---\n',
    'Atlas/Timeline/7b.md': '---\ntype: beat\ntitle: Soren arrives\nyear: 0\nday: 30\ncharacters: ["[[Soren]]"]\nlocation: "[[Port]]"\norder: 1\nmove: arrive\n---\n'
  })
)
const E = 'Characters/Elion.md'
const k = (y: number, d?: number) => sortKey(y, d)

describe('derived timelines', () => {
  it('main, character, location (with descendants) and custom', () => {
    expect(timelineBeats(ix, { kind: 'main' })).toHaveLength(8)
    expect(timelineBeats(ix, { kind: 'character', id: E }).map((b) => b.title)).toEqual(['Born', 'Leaves port', 'Enters capital', 'Audience', 'Thinks', 'Leaves capital'])
    expect(timelineBeats(ix, { kind: 'location', id: 'W/Capital.md' }).map((b) => b.title)).toEqual(['Enters capital', 'Audience', 'Leaves capital', 'Soren elsewhere'])
    expect(timelineBeats(ix, { kind: 'location', id: 'World/Aurelia.md' })).toHaveLength(7)
    expect(timelineBeats(ix, { kind: 'custom', slug: 'book-1' }).map((b) => b.title)).toEqual(['Leaves port'])
  })
})

describe('position at time', () => {
  it('unknown before the first located beat', () => {
    expect(positionAt(ix, E, k(-21)).kind).toBe('unknown')
  })
  it('year-only beat places the character for the whole year onward', () => {
    expect(positionAt(ix, E, k(-20, 200))).toMatchObject({ kind: 'at', location: 'W/Port.md' })
  })
  it('depart puts the character in transit toward the next located beat', () => {
    const p = positionAt(ix, E, k(0, 8))
    expect(p).toMatchObject({ kind: 'transit', from: 'W/Port.md', to: 'W/Capital.md' })
    if (p.kind === 'transit') expect(p.progress).toBeCloseTo(3 / 7)
  })
  it('arrive and later beats; a beat without location does not move them', () => {
    expect(positionAt(ix, E, k(0, 12))).toMatchObject({ kind: 'at', location: 'W/Capital.md' })
    expect(positionAt(ix, E, k(0, 21))).toMatchObject({ kind: 'at', location: 'W/Palace.md' })
  })
  it('after the last depart, transit with no destination', () => {
    expect(positionAt(ix, E, k(1))).toMatchObject({ kind: 'transit', from: 'W/Capital.md', to: undefined })
  })
  it('same-date beats are ordered by order', () => {
    expect(positionAt(ix, 'Characters/Soren.md', k(0, 30))).toMatchObject({ kind: 'at', location: 'W/Palace.md' })
  })
  it('who is here counts descendants', () => {
    expect(whoIsHere(ix, 'W/Capital.md', k(0, 25))).toEqual([E])
    expect(whoIsHere(ix, 'W/Capital.md', k(0, 30)).sort()).toEqual(['Characters/Soren.md'])
  })
})
