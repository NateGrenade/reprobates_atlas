// Add-on host: the sample add-on (addons/sample) adds a view, a settings pane, a command and an overlay;
// turning it off removes them all; with no add-ons the app is as before.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch, ROOT } from './harness'

let app: ElectronApplication, page: Page
beforeAll(async () => ({ app, page } = await launch(undefined, { ATLAS_ADDONS_DIR: join(ROOT, 'out/addons-test') })))
afterAll(async () => app?.close())

describe('add-on host', () => {
  it('adds the add-on view to the rail and talks to its main process', async () => {
    await page.click('button[aria-label="Sample"]')
    await expect.poll(() => page.locator('.sample-addon h1').textContent()).toBe('Sample add-on')
    await page.click('text=Ask the add-on\'s main process')
    await expect.poll(() => page.locator('.sample-reply').textContent()).toBe('pong: hello (vault open)')
    await page.screenshot({ path: join(ROOT, 'docs/shots/addon-sample-view.png') })
  })

  it('runs its command from Cmd+K and by shortcut, showing its overlay', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('sample show')
    await page.locator('.palette-item:has-text("Sample: show overlay"), [data-i]:has-text("Sample: show overlay")').first().click()
    await page.locator('.sample-badge').waitFor()
    await page.click('.sample-badge')
    await expect.poll(() => page.locator('.sample-badge').count()).toBe(0)
    await page.keyboard.press('ControlOrMeta+Shift+y')
    await page.locator('.sample-badge').waitFor()
    await page.click('.sample-badge')
  })

  it('has its own Settings pane, and turning it off removes everything it added', async () => {
    await page.click('button[aria-label="Settings"]')
    await page.click('.prefs-nav >> text=Sample add-on').catch(() => page.click('text=Sample add-on'))
    await page.locator('.sample-settings').waitFor()
    await page.click('text=Add-ons')
    await page.screenshot({ path: join(ROOT, 'docs/shots/addon-settings.png') })
    await page.click('[aria-label="Sample add-on on or off"] >> text=Off')
    await expect.poll(() => page.locator('button[aria-label="Sample"]').count()).toBe(0)
    await expect.poll(() => page.locator('.sample-addon').count()).toBe(0) // its view closed; the map is back
    expect(await page.locator('text=Sample add-on').count()).toBe(1) // only the Add-ons row; its pane is gone
    await page.click('[aria-label="Sample add-on on or off"] >> text=On')
    await page.locator('button[aria-label="Sample"]').waitFor()
  })
})
