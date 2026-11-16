import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchVault } from '../core/node'

describe('file watcher', () => {
  it('reports vault-relative paths of external edits and ignores dot-folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-watch-'))
    mkdirSync(join(dir, '.obsidian'))
    mkdirSync(join(dir, 'World'))
    const got: string[] = []
    const w = watchVault(dir, (ps) => got.push(...ps), 50)
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(join(dir, '.obsidian/workspace.json'), '{}')
    writeFileSync(join(dir, 'World/Aurelia.md'), 'x')
    const t0 = Date.now()
    while (!got.includes('World/Aurelia.md') && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25))
    await w.close()
    expect(got).toContain('World/Aurelia.md')
    expect(got.some((p) => p.startsWith('.obsidian'))).toBe(false)
  })
})
