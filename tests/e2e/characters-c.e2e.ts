// Group C real-input checks: card style picker, no source line on cards, remove a character (note kept / stub trashed) with Undo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => {
  ;({ app, page, vault } = await launch())
  await page.click('button[aria-label="Characters"]')
  await page.locator('.card').first().waitFor()
})
afterAll(async () => app?.close())
const note = (p: string) => readFileSync(join(vault, p), 'utf8')

describe('characters group C', () => {
  it('cards no longer show "from Supporting Cast"; the detail page names the source quietly', async () => {
    const chara = page.locator('.card[data-character="Atlas/Entities/Chara.md"]')
    expect(await chara.locator('.card-role').textContent()).toBe('')
    await chara.click()
    await expect.poll(() => page.locator('.detail-source').textContent()).toContain('Supporting Cast')
    await page.click('.detail-back')
  })

  it('the style picker writes card_style and tints the card', async () => {
    await page.locator('.card[data-character="Characters/Soren.md"]').click()
    await page.locator('.style-chip', { hasText: 'Antagonist' }).click()
    await expect.poll(() => note('Characters/Soren.md')).toContain('card_style: antagonist')
    await page.click('.detail-back')
    await expect.poll(() => page.locator('.card[data-character="Characters/Soren.md"]').getAttribute('class')).toContain('style-antagonist')
    await page.screenshot({ path: 'docs/shots/card-styles.png' })
  })

  it('Remove from Characters on a tagged note keeps the lore and only drops card keys; Undo restores', async () => {
    const before = note('Characters/Egoei.md')
    page.once('dialog', (d) => d.accept())
    await page.locator('.card[data-character="Characters/Egoei.md"]').click({ button: 'right' })
    await page.locator('.card-menu button', { hasText: 'Remove' }).click()
    await expect.poll(() => note('Characters/Egoei.md')).not.toContain('type: character')
    expect(note('Characters/Egoei.md').split('---')[2]).toBe(before.split('---')[2]) // body untouched
    await page.locator('.toast-undo').last().click()
    await expect.poll(() => note('Characters/Egoei.md')).toBe(before)
  })

  it('removing a heading stub trashes the stub file; Undo brings it back', async () => {
    await page.locator('.card[data-character="Atlas/Entities/Chara.md"]').click()
    page.once('dialog', (d) => d.accept())
    await page.locator('.remove-char').click()
    await expect.poll(() => existsSync(join(vault, 'Atlas/Entities/Chara.md'))).toBe(false)
    await page.locator('.toast-undo').last().click()
    await expect.poll(() => existsSync(join(vault, 'Atlas/Entities/Chara.md'))).toBe(true)
  })
})
