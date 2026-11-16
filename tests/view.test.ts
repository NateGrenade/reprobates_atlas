import { describe, it, expect } from 'vitest'
import { parseView } from '../core/config'
import { validateVault } from '../core/validate'
import { vault } from './helpers'

describe('Atlas/view.json', () => {
  it('parses lane choices; a broken file is an empty view', () => {
    expect(parseView('{"lanes":{"character":{"auto":false,"shown":["Characters/Elion.md"]}}}').lanes?.character).toEqual({ auto: false, shown: ['Characters/Elion.md'] })
    expect(parseView('{oops')).toEqual({})
    expect(parseView('[1]')).toEqual({})
    expect(parseView(undefined)).toEqual({})
  })
  it('validate warns about bad JSON or a bad lanes shape', () => {
    const w = (text: string) => validateVault(vault({ 'Atlas/view.json': text })).map((i) => `${i.severity}: ${i.message}`)
    expect(w('{"lanes":{"character":{"auto":false,"shown":[]}}}')).toEqual([])
    expect(w('{oops')[0]).toMatch(/^warning: Not valid JSON/)
    expect(w('{"lanes":{"character":{"shown":"x"}}}')[0]).toMatch(/^warning: 'lanes' must map/)
  })
})
