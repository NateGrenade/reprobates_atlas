import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ROOT, FIXTURE_COMMIT } from './harness'
let app: ElectronApplication, page: Page, vault: string, mcp: Client
const place = 'Atlas/Places/Test Parent.md', renamed = 'Atlas/Places/Renamed Parent.md'
const scene = 'Atlas/Maps/test-parent.scene.json'
const child = 'Atlas/Places/Test Child.md', beat = 'Atlas/Timeline/Test Event.md'
const call = async (name: string, args: object) => {
  const r: any = await mcp.callTool({ name, arguments: args as Record<string, unknown> })
  if (r.isError) throw new Error(r.content[0].text)
  return JSON.parse(r.content[0].text)
}
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-rename-e2e-')); vault = join(dir, 'vault')
  execFileSync('git', ['clone', '-q', join(ROOT, 'dev-vault'), vault])
  execFileSync('git', ['-C', vault, 'remote', 'remove', 'origin'])
  execFileSync('git', ['-C', vault, 'checkout', '-q', FIXTURE_COMMIT])
  for (const [path, text] of [
    [place, `---\ntype: location\ntitle: Original display\nmap_kind: planet\nmap_scene: ${scene}\n---\nParent lore\n`],
    [child, '---\ntype: location\nmap_kind: city\nparent: "[[Test Parent]]"\n---\nChild lore\n'],
    [beat, '---\ntype: beat\nyear: 1\nlocation: "[[Test Parent]]"\n---\nA visit to [[Test Parent#History|the place]].\n'],
    [scene, '{"version":1,"preset":"planet","params":{"ice":0.7}}\n'],
    ['Atlas/Places/Existing.md', '---\ntype: location\n---\n']
  ]) { mkdirSync(join(vault, path.split('/').slice(0,-1).join('/')), { recursive: true }); writeFileSync(join(vault, path), text) }
  app = await electron.launch({ args: [process.env.ATLAS_E2E_APP_ENTRY ?? join(ROOT, 'out/main/index.js')], env: { ...process.env, ATLAS_VAULT: vault, ATLAS_USER_DATA: join(dir, 'userdata'), ATLAS_SCRIPT: '', ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow(); await page.locator('.rail').waitFor()
  for (let i = 0; i < 50 && !existsSync(join(dir, 'userdata/live.json')); i++) await page.waitForTimeout(100)
  const { url } = JSON.parse(readFileSync(join(dir, 'userdata/live.json'), 'utf8'))
  mcp = new Client({ name: 'rename-e2e', version: '1' }); await mcp.connect(new StreamableHTTPClientTransport(new URL(url)))
})
afterAll(async () => { await mcp?.close(); await app?.close() })
describe('location rename', () => {
  it('validates, cancels, and updates the name, links, scene, and selection', async () => {
    await call('navigate', { select: place, map_level: place })
    await call('preview_scene', { path: place, params: { ice: 0.4 } })
    await page.getByRole('button', { name: 'Rename location' }).click()
    const input = page.getByLabel('Location name')
    await input.fill(''); await input.press('Enter')
    expect(await page.getByRole('alert').textContent()).toContain('valid name')
    await input.fill('Existing'); await input.press('Enter')
    expect(await page.getByRole('alert').textContent()).toContain('already exists')
    await input.press('Escape')
    expect(existsSync(join(vault, place))).toBe(true)
    await page.getByRole('button', { name: 'Rename location' }).click()
    await input.fill('Renamed Parent')
    page.once('dialog', (d) => d.accept())
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, renamed))).toBe(true)
    await expect.poll(() => page.locator('.insp-title').textContent()).toBe('Renamed Parent')
    const newText = readFileSync(join(vault, renamed), 'utf8')
    expect(newText).toContain('title: Renamed Parent')
    expect(newText).toContain(`map_scene: ${scene}`)
    expect(readFileSync(join(vault, child), 'utf8')).toContain('[[Renamed Parent]]')
    expect(readFileSync(join(vault, beat), 'utf8')).toContain('[[Renamed Parent#History|the place]]')
    expect(readFileSync(join(vault, beat), 'utf8')).toContain('location: "[[Renamed Parent]]"')
    expect(existsSync(join(vault, scene))).toBe(true)
    const state = await call('get_state', {})
    expect(state.selected).toBe(renamed)
    expect(state.map_level).toBe(renamed)
    const design = await call('describe_scene', { path: renamed })
    expect(design.unsaved_preview).toBe(true)
    expect(design.current.ice).toBe(0.4)
    await page.screenshot({ path: '/tmp/atlas-location-rename.png' })
  })
})
