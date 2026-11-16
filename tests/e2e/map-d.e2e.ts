// Group D real-input checks: the Add menu with body types, placing one, lifting it with X/Y/Z, orbit tilt.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())

describe('map group D', () => {
  it('Add… lists body types; picking one and clicking the ground creates it with that kind', async () => {
    await page.locator('.map-root canvas').waitFor()
    await page.waitForTimeout(2500)
    await page.click('.map-edit-btn')
    await page.click('.add-kind .map-edit-btn')
    await page.locator('.add-pop input').fill('stat')
    await page.locator('.add-kind-opt', { hasText: 'Space station' }).click()
    await expect.poll(() => page.locator('.add-kind .map-edit-btn').textContent()).toContain('Space station')
    const c = (await page.locator('.map-root canvas').boundingBox())!
    await page.mouse.click(c.x + c.width * 0.3, c.y + c.height * 0.78)
    const dialog = page.locator('.place-dialog')
    await dialog.waitFor()
    expect(await dialog.locator('select').inputValue()).toBe('station')
    await dialog.locator('input.field-input').first().fill('Smoke Station')
    await dialog.locator('button[type=submit]').click()
    const f = join(vault, 'Atlas/Places/Smoke Station.md')
    await expect.poll(() => existsSync(f)).toBe(true)
    expect(readFileSync(f, 'utf8')).toContain('map_kind: station')
  })

  it('X/Y/Z fields lift it off the plane and orbit tilt is saved', async () => {
    const f = join(vault, 'Atlas/Places/Smoke Station.md')
    const y = page.locator('input[aria-label="Position Y"]')
    await y.fill('14')
    await y.press('Enter')
    await expect.poll(() => readFileSync(f, 'utf8')).toMatch(/map_pos: \[-?[\d.]+, 14, -?[\d.]+\]/)
    const tilt = page.locator('input[aria-label="Orbit tilt"]')
    await tilt.fill('20')
    await tilt.press('Enter')
    await expect.poll(() => readFileSync(f, 'utf8')).toContain('map_inclination: 20')
    await page.screenshot({ path: 'docs/shots/map-3d-place.png' })
  })
})
