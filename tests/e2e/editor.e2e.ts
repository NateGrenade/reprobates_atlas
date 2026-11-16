// Real-input checks for S10: live-preview editing and tabs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())
const open = async (name: string) => {
  await page.keyboard.press('Meta+k')
  await page.locator('.palette-input').fill(name)
  await page.locator('.palette-item', { hasText: name }).first().click()
}

describe('live preview editor', () => {
  it('renders Aioni with markers hidden, and viewing never writes', async () => {
    await open('Aioni')
    await page.locator('.seg button', { hasText: 'Edit' }).click()
    await page.locator('.cm-content').waitFor()
    await page.waitForTimeout(400)
    // headings styled, '## ' hidden; wikilinks shown as links
    const h = page.locator('.cm-line.cm-lp-h2').first()
    await expect.poll(async () => (await h.textContent())?.startsWith('#')).toBe(false)
    expect(await page.locator('.cm-lp-link').count()).toBeGreaterThan(1)
    await page.screenshot({ path: 'docs/shots/s10-live-preview.png' })
    // switching modes without typing leaves the file untouched
    await page.locator('.seg button', { hasText: 'Source' }).click()
    await page.locator('.seg button', { hasText: 'Read' }).click()
    await page.waitForTimeout(900)
    expect(execFileSync('git', ['-C', vault, 'status', '--porcelain', '--', 'Characters/Aioni.md'], { encoding: 'utf8' })).toBe('')
  })

  it('typing in live preview saves; the line being edited shows raw markdown', async () => {
    await page.locator('.seg button', { hasText: 'Edit' }).click()
    const line = page.locator('.cm-line.cm-lp-h2').first()
    await line.click()
    await expect.poll(async () => (await line.textContent())?.startsWith('## ')).toBe(true)
    await page.keyboard.press('End')
    await page.keyboard.type(' (edited)')
    await expect.poll(() => readFileSync(join(vault, 'Characters/Aioni.md'), 'utf8'), { timeout: 4000 }).toContain(' (edited)')
    const diff = execFileSync('git', ['-C', vault, 'diff', '--numstat', '--', 'Characters/Aioni.md'], { encoding: 'utf8' })
    expect(diff.trim().split('\t').slice(0, 2)).toEqual(['1', '1'])
  })

  it('tabs: opening notes adds tabs, Cmd+W closes the active one', async () => {
    await open('Soren')
    await open('Egoei')
    const names = await page.locator('.tab .tab-name').allTextContents()
    expect(names).toEqual(expect.arrayContaining(['Aioni', 'Soren', 'Egoei']))
    await page.locator('.tab', { hasText: 'Soren' }).click()
    await expect.poll(async () => page.locator('.note-title').textContent()).toBe('Soren')
    await page.keyboard.press('Meta+w')
    await expect.poll(async () => page.locator('.tab .tab-name').allTextContents()).not.toContain('Soren')
  })
})
