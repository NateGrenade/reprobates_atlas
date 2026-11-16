// Real-input check of the calendar editor (free-text names, weekday list, no warnings), the axis and the pickers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())
const yaml = () => readFileSync(join(vault, 'Atlas/atlas.yaml'), 'utf8')
const eventFile = () => join(vault, 'Atlas/Timeline/Elion enters the Capital.md')

describe('calendars', () => {
  it('creates a calendar: the name takes spaces and hyphens, weekdays are a list', async () => {
    // Calendars open from the timeline toolbar's calendar button (not from Settings)
    await page.click('button[aria-label="Timeline"]')
    await page.locator('.tl-axis').waitFor()
    await page.click('.tl-toolbar .cal-btn')
    await page.locator('.calendars-panel').waitFor()
    expect(await page.locator('.calendars-panel .settings-head .tl-title').textContent()).toBe('Calendars')
    await page.click('text=+ Add calendar')
    const card = page.locator('.cal-card').first()
    const name = card.locator('.cal-name')
    await name.fill('')
    await expect.poll(() => name.inputValue()).toBe('') // stays empty while typing
    await name.pressSequentially('Aurelian Reckoning - Old Style')
    expect(await name.inputValue()).toBe('Aurelian Reckoning - Old Style')
    await card.locator('label:has-text("Book 1 begins in year") input').fill('1200')
    await card.locator('label:has-text("Label before") input').fill('BE')
    await card.locator('label:has-text("Label after") input').fill('AE')
    await expect.poll(async () => card.locator('.cal-preview').textContent()).toContain('14 February 1,200 AE')
    await card.locator('button:has-text("Customize weekdays")').click()
    for (let i = 0; i < 2; i++) await card.locator('.weekdays button:has-text("+ Add")').click()
    const rows = card.locator('.weekdays .month-row input')
    expect(await rows.count()).toBe(9)
    await rows.nth(7).fill('Starday, the eighth')
    await page.click('.settings-foot button:has-text("Save")')
    await expect.poll(yaml).toContain('year_zero_offset: 1200')
    expect(yaml()).toContain('name: Aurelian Reckoning - Old Style')
    expect(yaml()).toContain('slug: aurelian-reckoning-old-style')
    expect(yaml()).toContain('Starday, the eighth')
    await page.click('button[aria-label="Timeline"]')
    await page.locator('.tl-axis').waitFor()
    await page.click('button:has-text("Fit all")')
    await expect.poll(async () => (await page.locator('.tl-tick span').allTextContents()).join(' ')).toMatch(/AE|BE/)
  })

  it('sets an event date with the month/day pickers and a time', async () => {
    await page.locator('.beat', { hasText: 'Elion enters the Capital' }).first().click()
    const pick = page.locator('.date-pickers')
    await pick.waitFor()
    await pick.locator('select').selectOption({ label: 'March' })
    // 15 March 1200 AE = story year 0, day 31 + 28 + 15 = 74 (Earth months, epoch on 1 January)
    await expect.poll(() => readFileSync(eventFile(), 'utf8')).toContain('day: 74')
    await pick.locator('.dp-time').fill('18:30')
    await pick.locator('.dp-time').press('Enter')
    await expect.poll(() => readFileSync(eventFile(), 'utf8')).toContain('hour: 18')
    await expect.poll(async () => page.locator('.beat-date-human').textContent()).toBe('15 March 1,200 AE 18:30')
  })

  it('changing hours per day just re-displays: no warning, no file changes', async () => {
    const before = readFileSync(eventFile(), 'utf8')
    // ... and from the command palette
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.palette-input').fill('Calendars')
    await page.keyboard.press('Enter')
    await page.locator('.calendars-panel').waitFor()
    const card = page.locator('.cal-card').first()
    await card.locator('button:has-text("Customize hours")').click()
    await card.locator('label:has-text("Hours per day") input').fill('20')
    await page.click('.settings-foot button:has-text("Save")')
    await expect.poll(yaml).toContain('hours_per_day: 20')
    expect(await page.locator('.cal-warn').count()).toBe(0)
    expect(readFileSync(eventFile(), 'utf8')).toBe(before)
    // same stored moment, shown in 20-hour days: day 73 18:30 = 106,230 min = calendar day index 88 (30 March) + 630 min
    await expect.poll(async () => page.locator('.beat-date-human').textContent()).toBe('30 March 1,200 AE 10:30')
    await page.screenshot({ path: 'docs/shots/calendar-timeline.png' })
  })
})
