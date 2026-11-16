import { describe, it, expect } from 'vitest'
import { relinkFor } from '../core/relink'
import { changedLines, vault } from './helpers'

describe('link-safe rename', () => {
  it('rewrites only link targets, keeping headings, aliases, frontmatter quoting and other bytes', () => {
    const files = vault({
      'World/Aurelia.md': 'A planet.\n',
      'A.md': '---\nlocation: "[[Aurelia]]"\n---\nSee [[Aurelia]] and [[Aurelia#History|its past]].\n`[[Aurelia]]` in code stays.\n',
      'B.md': 'Path link [[World/Aurelia]] and embed ![[Aurelia]].\n',
      'C.md': 'No links here.\n'
    })
    const edits = relinkFor(files, 'World/Aurelia.md', 'World/Aurelia Prime.md')
    expect(edits.map((e) => e.path).sort()).toEqual(['A.md', 'B.md'])
    const a = edits.find((e) => e.path === 'A.md')!
    expect(a.text).toBe('---\nlocation: "[[Aurelia Prime]]"\n---\nSee [[Aurelia Prime]] and [[Aurelia Prime#History|its past]].\n`[[Aurelia]]` in code stays.\n')
    const b = edits.find((e) => e.path === 'B.md')!
    expect(b.text).toBe('Path link [[World/Aurelia Prime]] and embed ![[Aurelia Prime]].\n')
    expect(changedLines(files.get('B.md')!, b.text).removed).toHaveLength(1)
  })

  it('uses a path when the new bare name would be ambiguous', () => {
    const files = vault({ 'X/Old.md': '', 'Y/New.md': '', 'Z.md': '[[Old]]\n' })
    expect(relinkFor(files, 'X/Old.md', 'X/New.md')[0].text).toBe('[[X/New]]\n')
  })
})
