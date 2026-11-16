// D2 real-input check: add a second star to a system in the scene inspector and save it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())

describe('multi-star systems', () => {
  it('Add star twice in the scene inspector and save writes a stars list', async () => {
    await page.locator('.map-root canvas').waitFor()
    await page.keyboard.press('Meta+k')
    await page.locator('.palette-input').fill('Demo System Beta')
    await page.locator('.palette-item', { hasText: 'Demo System Beta' }).first().click()
    // enter the system so the preview is visible
    await page.locator('.inspector button', { hasText: 'Show on map' }).click()
    await page.keyboard.press('Meta+k')
    await page.locator('.palette-input').fill('Demo System Beta')
    await page.locator('.palette-item', { hasText: 'Demo System Beta' }).first().click()
    await page.locator('.add-star').click()
    await page.locator('.add-star').click()
    expect(await page.locator('.star-row').count()).toBe(3)
    await page.locator('.inspector button', { hasText: 'Save scene' }).click()
    const f = join(vault, 'Atlas/Maps/demo-system-beta.scene.json')
    await expect.poll(() => existsSync(f)).toBe(true)
    const spec = JSON.parse(readFileSync(f, 'utf8'))
    expect(spec.preset).toBe('system')
    expect(spec.params.stars).toHaveLength(3)
    expect(readFileSync(join(vault, 'Atlas/Demo/Demo System Beta.md'), 'utf8')).toContain('map_scene: Atlas/Maps/demo-system-beta.scene.json')
  })
})
