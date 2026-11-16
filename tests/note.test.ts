import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanVault } from '../core/node'
import { splitNote, joinNote, readFrontmatter, patchFrontmatter } from '../core/note'
import { DEV_VAULT, hasDevVault, changedLines } from './helpers'

describe.skipIf(!hasDevVault)('round-trip over dev-vault', () => {
  it('splits and re-joins every .md byte-identically, and parses its frontmatter', async () => {
    const files = await scanVault(DEV_VAULT)
    const mds = [...files.keys()].filter((p) => p.endsWith('.md'))
    expect(mds.length).toBeGreaterThan(40)
    for (const p of mds) {
      const raw = readFileSync(join(DEV_VAULT, p), 'utf8')
      const parts = splitNote(raw)
      const rebuilt = joinNote({ ...parts, body: String(parts.body) })
      expect(Buffer.from(rebuilt, 'utf8').equals(readFileSync(join(DEV_VAULT, p))), p).toBe(true)
      expect(readFrontmatter(raw).errors, p).toEqual([])
    }
  })

  it('adding type: character to Elion adds exactly one line and leaves the long description untouched', () => {
    // dev-vault may already have Elion tagged (S4); start from the untagged text
    const raw = patchFrontmatter(readFileSync(join(DEV_VAULT, 'Characters/Elion.md'), 'utf8'), 'type', undefined)
    const out = patchFrontmatter(raw, 'type', 'character')
    expect(changedLines(raw, out)).toEqual({ removed: [], added: ['type: character'] })
    expect(readFrontmatter(out).data.type).toBe('character')
    expect(readFrontmatter(out).data.description).toBe(readFrontmatter(raw).data.description)
  })

  it('patching Supporting Cast keeps the flow-style aliases line', () => {
    const raw = readFileSync(join(DEV_VAULT, 'Characters/Supporting Cast.md'), 'utf8')
    const out = patchFrontmatter(raw, 'status', 'canon')
    expect(changedLines(raw, out)).toEqual({ removed: ['status: provisional'], added: ['status: canon'] })
    expect(out).toContain('aliases: ["Chara", "Evelyn", "Aeros", "Dioikitis", "Michani", "Legion"]')
  })
})

describe('frontmatter patch', () => {
  const base = '---\nstatus: provisional\n# a comment\ntags:\n  - a\n  - b\ndescription: "x: y"\n---\nBody [[Elion]]\n'

  it('replaces only the target key line', () => {
    const out = patchFrontmatter(base, 'status', 'canon')
    expect(changedLines(base, out)).toEqual({ removed: ['status: provisional'], added: ['status: canon'] })
  })

  it('replaces a multi-line block list with a flow list', () => {
    const out = patchFrontmatter(base, 'tags', ['c'])
    expect(out).toBe('---\nstatus: provisional\n# a comment\ntags: [c]\ndescription: "x: y"\n---\nBody [[Elion]]\n')
  })

  it('handles an unindented block list', () => {
    const t = '---\ntags:\n- a\n- b\nk: v\n---\n'
    expect(patchFrontmatter(t, 'tags', [])).toBe('---\ntags: []\nk: v\n---\n')
  })

  it('quotes wikilinks', () => {
    const out = patchFrontmatter(base, 'affiliation', ['[[The Concord]]'])
    expect(out).toContain('affiliation: ["[[The Concord]]"]\n---')
    expect(readFrontmatter(out).data.affiliation).toEqual(['[[The Concord]]'])
  })

  it('adds frontmatter to a note without any', () => {
    expect(patchFrontmatter('# Title\n', 'type', 'location')).toBe('---\ntype: location\n---\n# Title\n')
  })

  it('preserves CRLF line endings', () => {
    const t = '---\r\nstatus: x\r\n---\r\nBody\r\n'
    expect(patchFrontmatter(t, 'type', 'item')).toBe('---\r\nstatus: x\r\ntype: item\r\n---\r\nBody\r\n')
    expect(patchFrontmatter(t, 'status', 'z')).toBe('---\r\nstatus: z\r\n---\r\nBody\r\n')
  })

  it('works with no trailing newline and with empty frontmatter', () => {
    expect(patchFrontmatter('---\na: 1\n---', 'a', 2)).toBe('---\na: 2\n---')
    expect(patchFrontmatter('---\n---\nx', 'a', 1)).toBe('---\na: 1\n---\nx')
  })

  it('removes a key without leaving a blank line', () => {
    expect(patchFrontmatter('---\na: 1\nb: 2\n---\n', 'b', undefined)).toBe('---\na: 1\n---\n')
    expect(patchFrontmatter('---\na: 1\nb: 2\n---\n', 'a', undefined)).toBe('---\nb: 2\n---\n')
  })

  it('reports key line numbers in file coordinates', () => {
    expect(readFrontmatter(base).keyLines).toEqual({ status: 2, tags: 4, description: 7 })
  })
})
