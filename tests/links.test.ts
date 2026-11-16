import { describe, it, expect } from 'vitest'
import { findLinks, parseLink, LinkResolver } from '../core/links'
import { sectionText } from '../core/markdown'
import { VaultIndex } from '../core/vault'
import { timelineBeats } from '../core/timeline'
import { vault } from './helpers'

const SC = `---\nstatus: provisional\naliases: ["Chara"]\n---\n## Chara\nA traveller.\n### Equipment\nA map.\n## Evelyn & Aeros\nOther entries.\n`

describe('wikilinks', () => {
  it('parses heading and alias', () => {
    expect(parseLink('[[Supporting Cast#Chara|Chara]]')).toMatchObject({ target: 'Supporting Cast', heading: 'Chara', alias: 'Chara' })
    expect(parseLink('Elion')).toBeNull()
  })

  it('ignores links in code', () => {
    const ls = findLinks('a [[A]] `[[B]]`\n```\n[[C]]\n```\n[[D|d]]')
    expect(ls.map((l) => l.target)).toEqual(['A', 'D'])
  })

  it('resolves by basename, path and case-insensitively', () => {
    const r = new LinkResolver(['Characters/Elion.md', 'World/Aurelia.md', 'Atlas/Portraits/elion.png'])
    expect(r.resolve('elion')).toBe('Characters/Elion.md')
    expect(r.resolve('World/Aurelia')).toBe('World/Aurelia.md')
    expect(r.resolve('Nope')).toBeNull()
    expect(r.resolve('elion.png')).toBe('Atlas/Portraits/elion.png')
  })

  it('[[Supporting Cast#Chara|Chara]] resolves to the heading section', () => {
    const ix = new VaultIndex(vault({ 'Characters/Supporting Cast.md': SC }))
    const l = parseLink('[[Supporting Cast#Chara|Chara]]')!
    const path = ix.resolver.resolve(l.target)
    expect(path).toBe('Characters/Supporting Cast.md')
    const sec = sectionText(ix.notes.get(path!)!.body, l.heading!)
    expect(sec).toBe('## Chara\nA traveller.\n### Equipment\nA map.\n')
  })

  it('a heading reference and its Atlas/Entities stub are one entity on one timeline', () => {
    const ix = new VaultIndex(
      vault({
        'Characters/Supporting Cast.md': SC,
        'Atlas/Entities/Chara.md': '---\ntype: character\nsource: "[[Supporting Cast#Chara]]"\n---\n',
        'Atlas/Timeline/A.md': '---\ntype: beat\ntitle: A\nyear: 1\ncharacters: ["[[Chara]]"]\n---\n',
        'Atlas/Timeline/B.md': '---\ntype: beat\ntitle: B\nyear: 2\ncharacters: ["[[Supporting Cast#Chara|Chara]]"]\n---\n'
      })
    )
    expect(ix.resolveEntity('[[Chara]]')).toBe('Atlas/Entities/Chara.md')
    expect(ix.resolveEntity('[[Supporting Cast#Chara|Chara]]')).toBe('Atlas/Entities/Chara.md')
    expect(timelineBeats(ix, { kind: 'character', id: 'Atlas/Entities/Chara.md' }).map((b) => b.title)).toEqual(['A', 'B'])
    expect(ix.loreOf('Atlas/Entities/Chara.md')).toContain('A traveller.')
    expect(ix.loreOf('Atlas/Entities/Chara.md')).not.toContain('Other entries.')
  })
})
