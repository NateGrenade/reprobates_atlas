import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, FIXTURE_COMMIT } from './harness'

let app: ElectronApplication, page: Page, server: Server, downloadDir: string
const pageErrors: string[] = []
let mode: 'missing' | 'available' | 'current' = 'missing'
const contents = Buffer.from('Atlas test DMG payload; not an installer')
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-update-e2e-'))
  const vault = join(dir, 'vault'); downloadDir = join(dir, 'downloads'); mkdirSync(downloadDir)
  execFileSync('git', ['clone', '-q', join(ROOT, 'dev-vault'), vault])
  execFileSync('git', ['-C', vault, 'remote', 'remove', 'origin'])
  execFileSync('git', ['-C', vault, 'checkout', '-q', FIXTURE_COMMIT])
  server = createServer((req, res) => {
    if (req.url === '/Atlas-universal.dmg') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': contents.length }); res.end(contents); return }
    if (mode === 'missing') { res.writeHead(404); res.end(); return }
    const base = `http://127.0.0.1:${(server.address() as any).port}`
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tag_name: mode === 'current' ? '0.0.1' : '999.0.0', assets: [{ name: 'Atlas-universal.dmg', browser_download_url: `${base}/Atlas-universal.dmg` }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const feed = `http://127.0.0.1:${(server.address() as any).port}/feed`
  app = await electron.launch({ ...(process.env.ATLAS_E2E_EXECUTABLE ? { executablePath: process.env.ATLAS_E2E_EXECUTABLE, args: [] } : { args: [process.env.ATLAS_E2E_APP_ENTRY ?? join(ROOT, 'out/main/index.js')] }), env: { ...process.env, ATLAS_VAULT: vault, ATLAS_USER_DATA: join(dir, 'userdata'), ATLAS_UPDATE_FEED: feed, ATLAS_DOWNLOAD_DIR: downloadDir, ATLAS_SCRIPT: '', ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow(); page.on('pageerror', (e) => pageErrors.push(e.message)); await page.locator('.rail').waitFor()
})
afterAll(async () => { await app?.close(); await new Promise<void>((resolve) => server.close(() => resolve())) })
describe('update check and download', () => {
  it('loads packaged Writer and Assistant add-ons', async () => {
    const addons = await page.evaluate(() => window.atlas.addons.list())
    expect(addons.find((a) => a.id === 'assistant')).toMatchObject({ enabled: true })
    expect(addons.find((a) => a.id === 'writer')).toMatchObject({ enabled: true })
    expect(addons.filter((a) => a.id === 'assistant' || a.id === 'writer').every((a) => !(a as any).error)).toBe(true)
    await page.getByRole('button', { name: 'Write', exact: true }).click()
    await expect.poll(() => page.locator('.writer').count()).toBeGreaterThan(0)
    await page.keyboard.press('ControlOrMeta+j')
    await page.locator('.asst-bar').waitFor()
    await page.keyboard.press('Escape')
    expect(pageErrors).toEqual([])
  })
  it('shows a useful error, reports up to date, and downloads the available release', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.prefs-nav-item', { hasText: 'About' }).click()
    const button = page.getByRole('button', { name: 'Check for updates' })
    await button.click()
    await expect.poll(() => page.locator('.prefs [role=status]').textContent()).toContain('HTTP 404')
    await page.screenshot({ path: '/tmp/atlas-update-missing.png' })
    mode = 'current'
    await button.click()
    await expect.poll(() => page.locator('.prefs [role=status]').textContent()).toContain('latest release')
    mode = 'available'
    await button.click()
    if (process.env.ATLAS_E2E_OLD_UPDATE_UI) await expect.poll(() => page.locator('.prefs [role=status]').textContent()).toContain('update notice')
    else await expect.poll(() => page.locator('.prefs').count()).toBe(0)
    const notice = page.locator('.update-notice')
    await expect.poll(() => notice.textContent()).toContain('999.0.0')
    await page.screenshot({ path: '/tmp/atlas-update-available.png' })
    if (process.env.ATLAS_E2E_OLD_UPDATE_UI) await page.getByRole('button', { name: 'Close settings' }).click()
    await notice.getByRole('button', { name: 'Download' }).click()
    await expect.poll(() => notice.textContent()).toContain('Download started')
    const file = join(downloadDir, 'Atlas-universal.dmg')
    await expect.poll(() => existsSync(file) && readFileSync(file).equals(contents)).toBe(true)
    await page.screenshot({ path: '/tmp/atlas-update-downloaded.png' })
  })
})
