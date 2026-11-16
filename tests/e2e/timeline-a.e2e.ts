// Group A real-input checks: deleting events, the Lanes menu, threads, drag between lanes, Undo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => {
  ;({ app, page, vault } = await launch())
  await page.click('button[aria-label="Timeline"]')
  await page.locator('.tl-track').first().waitFor()
  await page.click('.seg button:has-text("Characters")')
  await page.click('button:has-text("Fit all")')
})
afterAll(async () => app?.close())
const ev = (f: string) => join(vault, 'Atlas/Timeline', f)

describe('timeline group A', () => {
  it('right-click > Delete trashes the event; Undo brings it back', async () => {
    const chip = page.locator('.beat', { hasText: 'Demo CLI beat' }).first()
    await chip.click({ button: 'right' })
    await page.locator('.event-menu button', { hasText: 'Delete' }).click()
    await expect.poll(() => existsSync(ev('Demo CLI beat.md'))).toBe(false)
    await page.locator('.toast-undo').last().click()
    await expect.poll(() => existsSync(ev('Demo CLI beat.md'))).toBe(true)
  })

  it('Delete key removes the selected event; the editor has a Delete button', async () => {
    await page.locator('.beat', { hasText: 'Demo CLI beat' }).first().click()
    await page.locator('.beat-title-input').waitFor()
    await page.locator('.tl-axis').click({ position: { x: 5, y: 5 } }) // move focus off inputs, keep selection
    await page.keyboard.press('Delete')
    await expect.poll(() => existsSync(ev('Demo CLI beat.md'))).toBe(false)
    await page.locator('.toast-undo').last().click()
    await expect.poll(() => existsSync(ev('Demo CLI beat.md'))).toBe(true)
    await page.locator('.beat', { hasText: 'Demo CLI beat' }).first().click()
    await expect.poll(() => page.locator('.inspector button', { hasText: 'Delete event' }).count()).toBe(1)
  })

  it('Lanes menu adds Chara (empty lane) and hides No character; Chara lane + creates an event for her', async () => {
    await page.click('.lanes-btn')
    await page.locator('.lanes-pop input.field-input').fill('Chara')
    await page.locator('.lane-opt', { has: page.getByText('Chara', { exact: true }) }).locator('input').check()
    await page.locator('.lanes-pop input.field-input').fill('No character')
    await page.locator('.lane-opt', { hasText: 'No character' }).locator('input').uncheck()
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 450)
    const lanes = await page.locator('.tl-lane .tl-lane-label .n').allTextContents()
    expect(lanes.map((s) => s.trim())).toEqual(expect.arrayContaining(['Chara', 'Elion']))
    expect(lanes.map((s) => s.trim())).not.toContain('No character')
    await page.locator('.tl-lane[data-lane="Atlas/Entities/Chara.md"]').hover()
    await page.locator('.tl-lane[data-lane="Atlas/Entities/Chara.md"] .lane-add').click()
    await expect.poll(() => existsSync(ev('New event.md'))).toBe(true)
    expect(readFileSync(ev('New event.md'), 'utf8')).toContain('characters: ["[[Chara]]"]')
  })

  it('dragging an event down onto another lane reassigns it, with Undo', async () => {
    const chip = page.locator('.tl-lane[data-lane="Characters/Elion.md"] .beat', { hasText: 'Elion leaves the Capital' }).first()
    const from = (await chip.boundingBox())!
    const to = (await page.locator('.tl-lane[data-lane="Atlas/Entities/Chara.md"] .tl-track').boundingBox())!
    await page.mouse.move(from.x + 6, from.y + from.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 6, from.y + from.height / 2 + ((to.y + 20 - from.y - from.height / 2) * i) / 10)
    await page.mouse.up()
    const f = ev('Elion leaves the Capital.md')
    await expect.poll(() => readFileSync(f, 'utf8')).toContain('characters: ["[[Chara]]"]')
    await page.locator('.toast-undo').last().click()
    await expect.poll(() => readFileSync(f, 'utf8')).toContain('characters: ["[[Elion]]"]')
  })

  it('Threads: + New thread writes atlas.yaml, shows a lane, and the event editor can tag it', async () => {
    await page.click('.seg button:has-text("Threads")')
    await page.click('.new-thread')
    await page.locator('.thread-dialog input.field-input').first().fill('Obelisk hunt')
    await page.click('.thread-dialog button[type=submit]')
    await expect.poll(() => readFileSync(join(vault, 'Atlas/atlas.yaml'), 'utf8')).toContain('slug: obelisk-hunt')
    await expect.poll(async () => (await page.locator('.tl-lane-label .n').allTextContents()).map((s) => s.trim())).toContain('Obelisk hunt')
    await page.locator('.beat', { hasText: 'Elion enters the Capital' }).first().click()
    await page.locator('.inspector .chip', { hasText: 'Obelisk hunt' }).click()
    await expect.poll(() => readFileSync(ev('Elion enters the Capital.md'), 'utf8')).toContain('timelines: [obelisk-hunt]')
  })
})
