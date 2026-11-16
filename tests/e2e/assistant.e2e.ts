// Assistant add-on with a scripted provider (no real model): summon with Cmd+J, reply streams, hiding the bar
// does not stop the work, the result is there on reopening, and the conversation is kept.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch, ROOT } from './harness'

let app: ElectronApplication, page: Page
beforeAll(async () => ({ app, page } = await launch(undefined, { ATLAS_ADDONS_DIR: join(ROOT, 'out/addons-test'), ATLAS_ASSISTANT_FAKE: '1' })))
afterAll(async () => app?.close())
const DONE = 'You asked: what is on screen. This is a scripted reply.'

describe('assistant prompt bar', () => {
  it('opens on Cmd+J with the context it will see, and closes on Escape', async () => {
    await page.keyboard.press('ControlOrMeta+j')
    await page.locator('.asst-bar textarea').waitFor()
    expect(await page.locator('.asst-ctx').textContent()).toContain('Sees: Map')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.asst').count()).toBe(0)
    expect(await page.locator('.map-root, canvas').count()).toBeGreaterThan(0) // Escape did not leave the map
  })

  it('keeps working while hidden and has the answer when reopened', async () => {
    await page.keyboard.press('ControlOrMeta+j')
    await page.click('.asst-foot button:has-text("Test")')
    await page.keyboard.type('what is on screen')
    await page.keyboard.press('Enter')
    await page.locator('.asst-tool').waitFor()
    await page.keyboard.press('Escape') // hide mid-reply
    await page.locator('.asst-pulse').waitFor()
    await page.screenshot({ path: join(ROOT, 'docs/shots/assistant-working.png') })
    await page.click('button[aria-label="Timeline"]') // change view while it works
    await expect.poll(() => page.locator('.asst-pulse').count(), { timeout: 15000 }).toBe(0)
    await page.keyboard.press('ControlOrMeta+j')
    await expect.poll(() => page.locator('.asst-reply').last().textContent()).toContain(DONE)
    await page.screenshot({ path: join(ROOT, 'docs/shots/assistant-reply.png') })
  })

  it('lists the conversation under History and reopens it', async () => {
    await page.click('.asst-head button:has-text("New")')
    await expect.poll(() => page.locator('.asst-panel').count()).toBe(0)
    await page.click('.asst-foot button:has-text("History")')
    await page.click('.asst-list button:has-text("what is on screen")')
    await expect.poll(() => page.locator('.asst-reply').last().textContent()).toContain(DONE)
  })
})
