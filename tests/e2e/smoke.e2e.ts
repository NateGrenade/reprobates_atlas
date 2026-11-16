// Real-input smoke test: Playwright drives the built Electron app with real mouse and keyboard events.
// Run: npm run e2e   (builds first; uses a throwaway clone of dev-vault)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
const timelineFiles = () => readdirSync(join(vault, 'Atlas/Timeline'))
const newEventFiles = () => timelineFiles().filter((f) => f.startsWith('New event'))
async function waitFor(fn: () => boolean, ms = 5000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())

describe('timeline: adding events', () => {
  it('double-clicking a lane creates an event there', async () => {
    await page.click('button[aria-label="Timeline"]')
    const track = page.locator('.tl-track').first()
    await track.waitFor()
    const n = newEventFiles().length
    const box = (await track.boundingBox())!
    await page.mouse.dblclick(box.x + box.width * 0.35, box.y + 18)
    await waitFor(() => newEventFiles().length === n + 1)
    await page.locator('.beat-title-input').waitFor()
  })

  it('the toolbar button, a lane +, and typing a title work', async () => {
    const n = newEventFiles().length
    await page.click('button.new-event')
    await waitFor(() => newEventFiles().length === n + 1)
    const title = page.locator('.beat-title-input')
    await title.fill('Smoke test event')
    await title.press('Enter')
    await waitFor(() => timelineFiles().includes('Smoke test event.md'))
    const m = newEventFiles().length
    await page.locator('.tl-lane').first().hover()
    await page.locator('.lane-add').first().click()
    await waitFor(() => newEventFiles().length === m + 1)
  })

  it('Cmd+K "New event" creates one', async () => {
    const n = newEventFiles().length
    await page.keyboard.press('Meta+k')
    await page.locator('.palette-input').fill('new event')
    await page.keyboard.press('Enter')
    await waitFor(() => newEventFiles().length === n + 1)
  })

  it("a character's Inspector timeline has Add event, pre-filled with the character", async () => {
    await page.keyboard.press('Meta+k')
    await page.locator('.palette-input').fill('Soren')
    await page.locator('.palette-item', { hasText: 'Soren' }).first().click()
    const before = new Set(newEventFiles())
    await page.locator('.inspector button', { hasText: 'Add event' }).click()
    await waitFor(() => newEventFiles().length === before.size + 1)
    const f = newEventFiles().find((x) => !before.has(x))!
    expect(readFileSync(join(vault, 'Atlas/Timeline', f), 'utf8')).toContain('characters: ["[[Soren]]"]')
  })
})

describe('map edit mode with real mouse input', () => {
  it('clicking the ground opens New place and creates the location', async () => {
    await page.click('button[aria-label="Map"]')
    await page.locator('.map-root canvas').waitFor()
    await page.waitForTimeout(2500)
    await page.click('.map-edit-btn')
    const c = (await page.locator('.map-root canvas').boundingBox())!
    // empty ground in the lower left of the galaxy disc
    await page.mouse.click(c.x + c.width * 0.3, c.y + c.height * 0.78)
    const dialog = page.locator('.place-dialog')
    await dialog.waitFor({ timeout: 4000 })
    await dialog.locator('input.field-input').first().fill('Smoke Place')
    await dialog.locator('button[type=submit]').click()
    await waitFor(() => existsSync(join(vault, 'Atlas/Places/Smoke Place.md')))
    expect(readFileSync(join(vault, 'Atlas/Places/Smoke Place.md'), 'utf8')).toMatch(/map_pos: \[-?\d/)
  })

  it('dragging a marker moves the location (map_pos rewritten)', async () => {
    const path = join(vault, 'Atlas/Demo/Demo System Beta.md')
    const before = readFileSync(path, 'utf8').match(/map_pos: .*/)![0]
    const label = page.locator('.loc-label', { hasText: 'Demo System Beta' })
    const lb = (await label.boundingBox())!
    // the marker sits just under its label's leader line
    const x = lb.x + lb.width / 2, y = lb.y + lb.height + 14
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 8, y + i * 3)
    await page.mouse.up()
    await waitFor(() => readFileSync(path, 'utf8').match(/map_pos: .*/)![0] !== before)
    await page.click('.map-edit-btn')
  })
})
