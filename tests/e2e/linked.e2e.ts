// Linked events with real mouse input: link B (follows) and C (does not) to A, drag A, Undo, delete A.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())
const ev = (f: string) => join(vault, 'Atlas/Timeline', f + '.md')
const read = (f: string) => readFileSync(ev(f), 'utf8')
const A = 'Demo CLI beat', B = 'Elion leaves the Capital', C = 'Demo rename check one'
const chip = (t: string) => page.locator('.beat', { hasText: t }).first()
const day = (f: string) => Number(/^day: (\d+)$/m.exec(read(f))![1])

describe('linked events', () => {
  let a0 = '', b0 = '', c1 = ''
  it('links B (moves with A) from the right-click menu and C (stays) from the editor', async () => {
    await page.click('button[aria-label="Timeline"]')
    await page.locator('.tl-axis').waitFor()
    await page.click('.tl-toolbar .seg button:has-text("Main")')
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.palette-input').fill(A)
    await page.keyboard.press('Enter')
    await page.locator('.inspector button', { hasText: 'Show on timeline' }).click()
    await page.waitForTimeout(900)
    // zoom around A until B (12 days later) sits 80-150 px away: day snapping, and C (30 days) on screen
    for (let i = 0; i < 40; i++) {
      const a = (await chip(A).boundingBox())!
      const gap = (await chip(B).boundingBox({ timeout: 500 }).catch(() => null))?.x
      const d = gap === undefined ? 999 : gap - a.x
      if (d >= 80 && d <= 150) break
      await page.mouse.move(a.x + 4, a.y + a.height / 2)
      await page.mouse.wheel(0, d > 150 ? 40 : -40)
      await page.waitForTimeout(120)
    }
    a0 = read(A)
    b0 = read(B)

    await chip(B).click({ button: 'right' })
    await page.locator('.event-menu button', { hasText: 'Link to main event…' }).click()
    await page.locator('.event-menu .event-picker input').pressSequentially('CLI')
    await page.locator('.event-menu .event-opt', { hasText: A }).click()
    await expect.poll(() => read(B)).toContain('main_event: "[[Demo CLI beat]]"')
    await chip(B).click()
    await page.locator('.follow-toggle').click()
    await expect.poll(() => read(B)).toContain('follows_main: true')
    expect(await chip(B).locator('.beat-link.on').count()).toBe(1)
    await expect.poll(() => page.locator('.follow-offset').textContent()).toBe('+12 days from “Demo CLI beat”')
    await page.waitForTimeout(400) // let the chip transition finish
    await page.screenshot({ path: 'docs/shots/linked-sub-editor.png' })
    b0 = read(B)

    await chip(C).click()
    await page.locator('.inspector .main-pick').click()
    await page.locator('.main-pop input').pressSequentially('Demo CLI')
    await page.locator('.main-pop .event-opt', { hasText: A }).click()
    await expect.poll(() => read(C)).toContain('main_event: "[[Demo CLI beat]]"')
    expect(read(C)).not.toContain('follows_main')
    c1 = read(C)

    await chip(A).click()
    await expect.poll(() => page.locator('.sub-row').count()).toBe(2)
    expect(await page.locator('.sub-row', { hasText: B }).locator('.sub-offset').textContent()).toBe('+12 days')
    expect(await page.locator('.sub-row', { hasText: B }).locator('.sub-follow').textContent()).toBe('moves with it')
    expect(await page.locator('.sub-row', { hasText: C }).locator('.sub-follow').textContent()).toBe('stays')
    expect(await page.locator('.beat.kin').count()).toBe(2)
    await page.screenshot({ path: 'docs/shots/linked-events.png' })
  })

  it('dragging A moves B live and on drop by the same days; C stays byte-identical; one Undo restores A and B', async () => {
    const a = (await chip(A).boundingBox())!
    const bx0 = (await chip(B).boundingBox())!.x
    const cx0 = (await chip(C).boundingBox())!.x
    const y = a.y + a.height / 2
    await page.mouse.move(a.x + 30, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + 30 + i * 6, y)
    // mid-drag: B follows the pointer, C does not
    await expect.poll(async () => (await chip(B).boundingBox())!.x - bx0).toBeCloseTo(72, -1)
    expect((await chip(C).boundingBox())!.x).toBeCloseTo(cx0, 0)
    expect(await chip(B).evaluate((el) => el.classList.contains('following'))).toBe(true)
    await page.screenshot({ path: 'docs/shots/linked-drag.png' })
    await page.mouse.up()
    await expect.poll(() => read(A)).not.toBe(a0)
    const n = day(A) - 20
    expect(n).toBeGreaterThan(0)
    await expect.poll(() => day(B)).toBe(32 + n)
    expect(read(C)).toBe(c1)
    const toast = page.locator('.toast-bar', { hasText: 'and 1 linked event' })
    await toast.waitFor()
    await toast.locator('.toast-undo').click()
    await expect.poll(() => read(A)).toBe(a0)
    await expect.poll(() => read(B)).toBe(b0)
    expect(read(C)).toBe(c1)
  })

  it('typing a new date in the editor moves B too; Undo restores both', async () => {
    await chip(A).click()
    const input = page.locator('.inspector .beat-date')
    await input.click()
    await input.fill('0 d25')
    await input.press('Enter')
    await expect.poll(() => day(A)).toBe(25)
    await expect.poll(() => day(B)).toBe(37)
    expect(read(C)).toBe(c1)
    const toast = page.locator('.toast-bar', { hasText: 'and 1 linked event' })
    await toast.waitFor()
    await toast.locator('.toast-undo').click()
    await expect.poll(() => read(A)).toBe(a0)
    await expect.poll(() => read(B)).toBe(b0)
  })

  it('sub-event rows: the follow toggle writes follows_main, the title selects the sub-event', async () => {
    await chip(A).click()
    const row = page.locator('.sub-row', { hasText: C })
    await row.locator('.sub-follow').click()
    await expect.poll(() => read(C)).toContain('follows_main: true')
    await row.locator('.sub-follow').click()
    await expect.poll(() => read(C)).toBe(c1)
    await row.locator('.sub-title').click()
    await expect.poll(() => page.locator('.beat-title-input').inputValue()).toBe(C)
  })

  it('deleting A says how many sub-events get unlinked; Undo restores all three files exactly', async () => {
    let asked = ''
    page.once('dialog', (d) => ((asked = d.message()), d.accept()))
    await chip(A).click({ button: 'right' })
    await page.locator('.event-menu button', { hasText: 'Delete' }).click()
    await expect.poll(() => existsSync(ev(A))).toBe(false)
    expect(asked).toContain('main event of 2 sub-events')
    expect(asked).toContain('unlinked')
    expect(read(B)).not.toContain('main_event')
    expect(read(C)).not.toContain('main_event')
    await page.locator('.toast-bar', { hasText: 'Deleted' }).locator('.toast-undo').click()
    await expect.poll(() => existsSync(ev(A))).toBe(true)
    await expect.poll(() => read(B)).toBe(b0)
    expect(read(C)).toBe(c1)
    expect(read(A)).toBe(a0)
  })

  it('+ Add sub-event creates a linked event at the same date', async () => {
    await chip(A).click()
    await page.locator('.inspector .add-sub').click()
    await expect.poll(() => existsSync(ev('New event'))).toBe(true)
    const t = read('New event')
    expect(t).toContain('main_event: "[[Demo CLI beat]]"')
    expect(t).toMatch(/^year: 0$/m)
    expect(t).toMatch(/^day: 20$/m)
    await expect.poll(() => page.locator('.inspector .main-event-field .token-main').textContent()).toBe(A)
  })

  it('Unlink from the right-click menu and from the editor ×, each with Undo', async () => {
    await chip(B).click({ button: 'right' })
    await page.locator('.event-menu button', { hasText: 'Unlink from main event' }).click()
    await expect.poll(() => read(B)).not.toContain('main_event')
    expect(read(B)).not.toContain('follows_main')
    await page.locator('.toast-bar', { hasText: 'Unlinked' }).locator('.toast-undo').click()
    await expect.poll(() => read(B)).toBe(b0)
    await chip(C).click()
    await page.locator('.inspector button[aria-label="Unlink from main event"]').click()
    await expect.poll(() => read(C)).not.toContain('main_event')
    await page.locator('.toast-bar', { hasText: 'Unlinked' }).locator('.toast-undo').click()
    await expect.poll(() => read(C)).toBe(c1)
  })

  it('renaming the main event re-points its sub-events at the new file', async () => {
    await chip(A).click()
    const title = page.locator('.beat-title-input')
    await title.click()
    await title.fill('Soren awakens')
    await title.press('Enter')
    await expect.poll(() => existsSync(ev('Soren awakens'))).toBe(true)
    expect(existsSync(ev(A))).toBe(false)
    await expect.poll(() => read(B)).toContain('main_event: "[[Soren awakens]]"')
    expect(read(C)).toContain('main_event: "[[Soren awakens]]"')
    expect(read('New event')).toContain('main_event: "[[Soren awakens]]"')
  })
})
