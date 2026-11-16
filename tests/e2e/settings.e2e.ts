// Settings screen (gear on the rail) and its persistence, Calendars as their own panel, lane choices in the vault.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string, dir: string
beforeAll(async () => ({ app, page, vault, dir } = await launch()))
afterAll(async () => app?.close())
const viewFile = () => join(vault, 'Atlas/view.json')
const fontSize = (sel: string) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

describe('lane choices live in the vault', () => {
  it('moves lane choices from localStorage into Atlas/view.json once', async () => {
    expect(existsSync(viewFile())).toBe(false)
    const root = vault
    await page.evaluate((r) => localStorage.setItem(`atlas.lanes.${r}`, JSON.stringify({ character: { auto: false, shown: ['Characters/Elion.md'] } })), root)
    await page.reload()
    await page.waitForSelector('.rail')
    await expect.poll(() => existsSync(viewFile())).toBe(true)
    expect(JSON.parse(readFileSync(viewFile(), 'utf8'))).toEqual({ lanes: { character: { auto: false, shown: ['Characters/Elion.md'] } } })
    expect(await page.evaluate((r) => localStorage.getItem(`atlas.lanes.${r}`), root)).toBeNull()
  })

  it('hiding a lane on the timeline writes the choice to Atlas/view.json', async () => {
    await page.click('button[aria-label="Timeline"]')
    await page.locator('.tl-axis').waitFor()
    await page.click('.tl-toolbar .seg button:has-text("Places")')
    const lane = page.locator('.tl-lane').first()
    const id = (await lane.getAttribute('data-lane'))!
    const label = (await lane.getAttribute('data-label'))!
    await lane.hover()
    await page.click(`button[aria-label="Hide lane ${label}"]`)
    await expect.poll(() => JSON.parse(readFileSync(viewFile(), 'utf8')).lanes?.location?.auto).toBe(false)
    const v = JSON.parse(readFileSync(viewFile(), 'utf8'))
    expect(v.lanes.location.shown).not.toContain(id)
    expect(v.lanes.character).toEqual({ auto: false, shown: ['Characters/Elion.md'] }) // other groupings kept
  })
})

describe('Calendars are their own panel', () => {
  it('opens from the timeline calendar button and from Cmd+K "Calendars"', async () => {
    await page.click('.tl-toolbar .cal-btn')
    const panel = page.locator('.calendars-panel')
    await panel.waitFor()
    expect(await panel.locator('.settings-head .tl-title').textContent()).toBe('Calendars')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'docs/shots/calendars.png' })
    await panel.locator('.settings-foot button:has-text("Cancel")').click()
    await expect.poll(() => panel.count()).toBe(0)
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.palette-input').pressSequentially('Calendars')
    await page.keyboard.press('Enter')
    await panel.waitFor()
    await panel.locator('.settings-foot button:has-text("Cancel")').click()
    await expect.poll(() => panel.count()).toBe(0)
  })
})

describe('Settings', () => {
  it('the gear opens Settings with its sections; Timeline shows the vault lane choices', async () => {
    await page.click('button[aria-label="Settings"]')
    const prefs = page.locator('.prefs')
    await prefs.waitFor()
    expect((await prefs.locator('.prefs-nav-item').allTextContents()).map((s) => s.trim())).toEqual(['General', 'Appearance', 'Timeline', 'Add-ons', 'About'])
    expect(await prefs.locator('.prefs-path').textContent()).toBe(vault)
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'docs/shots/settings-general.png' })
    await prefs.locator('.prefs-nav-item', { hasText: 'Timeline' }).click()
    expect(await prefs.locator('[data-lanes="character"]').textContent()).toBe('1 lane chosen')
    await prefs.locator('.prefs-row', { hasText: 'By characters' }).locator('button:has-text("Reset to automatic")').click()
    await expect.poll(() => JSON.parse(readFileSync(viewFile(), 'utf8')).lanes.character).toBeUndefined()
    await prefs.locator('.prefs-nav-item', { hasText: 'Add-ons' }).click()
    await expect.poll(() => prefs.locator('.prefs-empty').textContent()).toContain('No add-ons installed')
    await prefs.locator('.prefs-nav-item', { hasText: 'About' }).click()
    expect(await prefs.locator('.prefs-app').textContent()).toBe('Reprobates Atlas')
  })

  it('text size and launch view persist across a relaunch', async () => {
    const prefs = page.locator('.prefs')
    await prefs.locator('.prefs-nav-item', { hasText: 'Appearance' }).click()
    const before = await fontSize('.prefs-nav-item')
    await prefs.locator('[aria-label="Text size"] button', { hasText: 'Large' }).click()
    await expect.poll(() => fontSize('.prefs-nav-item')).toBeCloseTo(before * 1.15, 1)
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'docs/shots/settings-appearance.png' })
    await prefs.locator('[aria-label="Reduce motion"] button', { hasText: 'On' }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'userdata/settings.json'), 'utf8')).prefs.reduceMotion).toBe('on')
    await prefs.locator('[aria-label="Reduce motion"] button', { hasText: 'Off' }).click()
    await prefs.locator('.prefs-nav-item', { hasText: 'General' }).click()
    await prefs.locator('[aria-label="Open on launch"] button', { hasText: 'Timeline' }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(dir, 'userdata/settings.json'), 'utf8')).prefs).toEqual({ textSize: 'large', reduceMotion: 'off', defaultView: 'timeline' })
    await page.keyboard.press('Escape')
    await expect.poll(() => prefs.count()).toBe(0)
    // the vault is untouched by app preferences
    expect(readFileSync(viewFile(), 'utf8')).not.toContain('large')

    await app.close()
    ;({ app, page } = await launch(dir))
    await page.locator('.tl-axis').waitFor() // opened on the timeline
    expect(await fontSize('.tl-title')).toBeCloseTo(19 * 1.15, 1)
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'docs/shots/text-large-timeline.png' })
    await page.click('button[aria-label="Settings"]')
    await page.locator('.prefs-nav-item', { hasText: 'Appearance' }).click()
    expect(await page.locator('[aria-label="Text size"] button.on').textContent()).toBe('Large')
  })

  it('Esc closes Settings over the map without flying the map out', async () => {
    await page.keyboard.press('Escape')
    await page.click('button[aria-label="Map"]')
    const crumb = page.locator('.crumb.current')
    await expect.poll(() => crumb.textContent(), { timeout: 8000 }).toBe('Demo Galaxy')
    await page.waitForTimeout(800)
    await page.click('button[aria-label="Settings"]')
    await page.locator('.prefs').waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.prefs').count()).toBe(0)
    await page.waitForTimeout(1500)
    expect(await crumb.textContent()).toBe('Demo Galaxy')
  })

  it('Cmd+K "Settings" opens Settings; About opens the data contract in Files', async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.palette-input').pressSequentially('Settings')
    await page.keyboard.press('Enter')
    const prefs = page.locator('.prefs')
    await prefs.waitFor()
    await prefs.locator('.prefs-nav-item', { hasText: 'About' }).click()
    await prefs.locator('.about-contract').click()
    await expect.poll(() => prefs.count()).toBe(0)
    await expect.poll(() => page.locator('button[aria-label="Files"].active').count()).toBe(1)
    await expect.poll(() => page.getByText('This folder belongs to').count()).toBeGreaterThan(0)
  })
})
