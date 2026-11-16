import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateVault } from '../core/validate'
import { validateSceneText } from '../core/scene'
import { DEV_VAULT, hasDevVault, vault } from './helpers'

const CLI = resolve(__dirname, '../cli/atlas.ts')
const TSX = ['--import', 'tsx']
function runCli(dir: string) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [...TSX, CLI, 'validate', dir], { encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status as number, out: String(e.stdout) }
  }
}

describe.skipIf(!hasDevVault)('atlas validate CLI', () => {
  it('passes on dev-vault', () => {
    const r = runCli(DEV_VAULT)
    expect(r.out).toMatch(/^0 error\(s\)/m)
    expect(r.code).toBe(0)
  })
})

describe('atlas validate CLI on a broken beat', () => {
  it('fails with file and line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-broken-'))
    mkdirSync(join(dir, 'Atlas/Timeline'), { recursive: true })
    writeFileSync(join(dir, 'Elion.md'), '---\ntype: character\n---\n')
    writeFileSync(join(dir, 'Atlas/Timeline/Bad.md'), '---\ntype: beat\ntitle: Bad\nyear: -8.5\ncharacters: [[Elion]]\n---\n')
    const r = runCli(dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('Atlas/Timeline/Bad.md:4: error:')
    expect(r.out).toContain('Atlas/Timeline/Bad.md:5: error:')
    expect(r.out).toMatch(/unquoted wikilink/)
  })
})

describe('validation rules', () => {
  it('flags bad locations, cycles and scene specs with lines', () => {
    const issues = validateVault(
      vault({
        'A.md': '---\ntype: location\nparent: "[[B]]"\nmap_kind: saucer\n---\n',
        'B.md': '---\ntype: location\nparent: "[[A]]"\nmap_scene: Atlas/Maps/b.scene.json\n---\n',
        'Atlas/Maps/b.scene.json': '{\n  "version": 1,\n  "preset": "galaxy",\n  "params": { "arms": "four" }\n}\n'
      })
    )
    const msg = issues.map((i) => `${i.file}:${i.line}: ${i.message}`)
    expect(msg.some((m) => m.startsWith('A.md:4:') && m.includes('map_kind'))).toBe(true)
    expect(msg.some((m) => m.startsWith('A.md:3:') && m.includes('cycle'))).toBe(true)
    expect(msg.some((m) => m.startsWith('Atlas/Maps/b.scene.json:4:') && m.includes('arms'))).toBe(true)
  })

  it('scene JSON syntax errors carry a line', () => {
    const r = validateSceneText('{\n "version": 1,\n "preset": \n}')
    expect(r.issues[0].line).toBe(4)
    expect(validateSceneText('{"version":1,"preset":"planet","params":{"color":"#123456"}}').issues).toEqual([])
  })
})

describe('scene spec stars', () => {
  it('galaxy star counts and system star lists both validate', () => {
    expect(validateSceneText('{"version":1,"preset":"galaxy","params":{"stars":60000}}').issues).toEqual([])
    expect(validateSceneText('{"version":1,"preset":"system","params":{"stars":[{"color":"#ffd59a","size":5,"name":"A"},{"color":"#a9c1ff","size":3}]}}').issues).toEqual([])
    expect(validateSceneText('{"version":1,"preset":"system","params":{"stars":[{"colour":"red"}]}}').issues.length).toBeGreaterThan(0)
  })
})
