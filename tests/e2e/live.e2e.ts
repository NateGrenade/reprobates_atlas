// Atlas Live over its real HTTP transport: an agent reads a planet's look, previews a change, and can only
// save it when the user presses Apply on the card in the window. Undo restores the vault.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { launch, ROOT } from './harness'

let app: ElectronApplication, page: Page, vault: string, dir: string, mcp: Client
const PLANET = 'Atlas/Places/potato.md'
const SCENE = () => join(vault, 'Atlas/Maps/potato.scene.json')
const call = async (name: string, args: object = {}) => {
  const r: any = await mcp.callTool({ name, arguments: args as any })
  const t = r.content.find((c: any) => c.type === 'text')?.text
  return { error: !!r.isError, text: t as string, json: t && !r.isError ? JSON.parse(t) : null, content: r.content }
}
beforeAll(async () => {
  ;({ app, page, vault, dir } = await launch())
  for (let i = 0; i < 50 && !existsSync(join(dir, 'userdata/live.json')); i++) await page.waitForTimeout(100)
  const { url } = JSON.parse(readFileSync(join(dir, 'userdata/live.json'), 'utf8'))
  mcp = new Client({ name: 'e2e', version: '0' })
  await mcp.connect(new StreamableHTTPClientTransport(new URL(url)))
})
afterAll(async () => app?.close())

describe('Atlas Live', () => {
  it('reports state and a picture of the window', async () => {
    expect((await call('get_state')).json.view).toBe('map')
    const shot = (await call('capture_view')).content[0]
    expect(shot.type).toBe('image')
    expect(Buffer.from(shot.data, 'base64').subarray(1, 4).toString()).toBe('PNG')
  })

  it('describes a planet and previews a change without saving', async () => {
    const d = (await call('describe_scene', { path: PLANET })).json
    expect(d.preset).toBe('planet')
    expect(d.settings.map((s: any) => s.key)).toEqual(expect.arrayContaining(['sea', 'continents', 'ice', 'ocean', 'lights']))
    const bad = await call('preview_scene', { path: PLANET, params: { oceans: '#ff0000' } })
    expect(bad.error).toBe(true)
    expect(bad.text).toContain('"oceans" is not a planet setting')
    expect((await call('preview_scene', { path: PLANET, params: { ice: 7 } })).text).toContain('from 0 to 1')
    await call('navigate', { view: 'map', map_level: PLANET }) // returns once the fly-in has arrived
    expect(await page.locator('.crumbs, .breadcrumbs, [class*=crumb]').first().textContent()).toContain('potato')
    await page.screenshot({ path: join(ROOT, 'docs/shots/design-before.png') })
    expect((await call('preview_scene', { path: PLANET, params: { ocean: '#7a2230', land: '#c9a45c', continents: 3.2, ice: 0.7, clouds: 0.1, lights: 1 } })).error).toBe(false)
    await page.screenshot({ path: join(ROOT, 'docs/shots/design-preview.png') })
    expect((await call('get_state')).json.map_level).toBe(PLANET)
    expect(existsSync(SCENE())).toBe(false)
  })

  it('saves only when the user presses Apply; Skip leaves the vault alone', async () => {
    const skipped = call('apply_scene', { path: PLANET })
    await page.locator('.live-ask').waitFor()
    expect(await page.locator('.live-ask li').allTextContents()).toEqual(expect.arrayContaining(['Ocean: default → #7a2230', 'Ice caps: default → 0.7']))
    await page.screenshot({ path: join(ROOT, 'docs/shots/design-ask.png') })
    await page.click('.live-ask button:has-text("Skip")')
    expect((await skipped).json.saved).toBe(false)
    expect(existsSync(SCENE())).toBe(false)

    const applied = call('apply_scene', { path: PLANET })
    await page.click('.live-ask button:has-text("Apply")')
    expect((await applied).json).toEqual({ saved: true, file: 'Atlas/Maps/potato.scene.json' })
    expect(JSON.parse(readFileSync(SCENE(), 'utf8')).params).toMatchObject({ ocean: '#7a2230', ice: 0.7, continents: 3.2 })
    expect(readFileSync(join(vault, PLANET), 'utf8')).toContain('map_scene: Atlas/Maps/potato.scene.json')
    expect((await call('apply_scene', { path: PLANET })).text).toContain('Nothing to apply')
  })

  it('Undo on the toast puts the vault back', async () => {
    await page.click('.toast-undo')
    await expect.poll(() => existsSync(SCENE())).toBe(false)
    expect(readFileSync(join(vault, PLANET), 'utf8')).not.toContain('map_scene')
  })
})
