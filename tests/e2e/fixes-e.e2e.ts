// Round E real-input checks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { ElectronApplication, Page } from 'playwright'
import { launch } from './harness'

let app: ElectronApplication, page: Page, vault: string
beforeAll(async () => ({ app, page, vault } = await launch()))
afterAll(async () => app?.close())
void (() => vault)

describe('map selection', () => {
  it('clicking empty space never selects a character', async () => {
    await page.locator('.map-root canvas').waitFor()
    await page.waitForTimeout(2500)
    const c = (await page.locator('.map-root canvas').boundingBox())!
    for (const [fx, fy] of [[0.5, 0.5], [0.42, 0.45], [0.6, 0.55], [0.2, 0.2]]) {
      await page.mouse.click(c.x + c.width * fx, c.y + c.height * fy)
      await page.waitForTimeout(150)
      expect(await page.locator('.insp-kicker', { hasText: /character/i }).count()).toBe(0)
    }
  })
})

describe('removing places', () => {
  const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const place = async (name: string, fx: number, fy: number) => {
    const c = (await page.locator('.map-root canvas').boundingBox())!
    await page.mouse.click(c.x + c.width * fx, c.y + c.height * fy)
    const dialog = page.locator('.place-dialog')
    await dialog.waitFor()
    await dialog.locator('input.field-input').first().fill(name)
    await dialog.locator('button[type=submit]').click()
    await expect.poll(() => existsSync(join(vault, `Atlas/Places/${name}.md`))).toBe(true)
  }
  it('Remove place asks first, trashes a placement-only note, and Cmd+Z brings back the last deletes in order', async () => {
    await page.click('.map-edit-btn')
    await place('Gone One', 0.3, 0.78)
    await place('Gone Two', 0.25, 0.3)
    const f1 = join(vault, 'Atlas/Places/Gone One.md'), f2 = join(vault, 'Atlas/Places/Gone Two.md')
    const t1 = readFileSync(f1, 'utf8'), t2 = readFileSync(f2, 'utf8')
    let asked = ''
    page.on('dialog', (d) => ((asked = d.message()), d.accept()))
    await page.click('.remove-place') // Gone Two is selected after creation
    await expect.poll(() => existsSync(f2)).toBe(false)
    expect(asked).toContain('Remove “Gone Two” from the map?')
    expect(asked).toContain('moved to the trash')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    // select Gone One through the palette-free route: click its label
    await page.locator('.map-label', { hasText: 'Gone One' }).first().click({ force: true }).catch(() => null)
    if (!(await page.locator('.insp-title', { hasText: 'Gone One' }).count())) {
      const c = (await page.locator('.map-root canvas').boundingBox())!
      await page.mouse.click(c.x + c.width * 0.3, c.y + c.height * 0.78)
    }
    await page.locator('.insp-title', { hasText: 'Gone One' }).waitFor()
    await page.click('.remove-place')
    await expect.poll(() => existsSync(f1)).toBe(false)
    await page.waitForTimeout(7500) // toast gone; the undo stack still holds both
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => existsSync(f1)).toBe(true)
    expect(existsSync(f2)).toBe(false)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => existsSync(f2)).toBe(true)
    expect(readFileSync(f1, 'utf8')).toBe(t1)
    expect(readFileSync(f2, 'utf8')).toBe(t2)
  })
})

describe('map levels', () => {
  const { existsSync, readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  it('removing the system you are inside leaves a working map', async () => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const c = (await page.locator('.map-root canvas').boundingBox())!
    await page.mouse.dblclick(c.x + c.width * 0.3, c.y + c.height * 0.78) // enter Gone One
    await expect.poll(() => page.locator('.crumb.current').textContent(), { timeout: 8000 }).toBe('Gone One')
    await page.waitForTimeout(600)
    await page.click('.remove-place')
    await expect.poll(() => existsSync(join(vault, 'Atlas/Places/Gone One.md'))).toBe(false)
    await expect.poll(() => page.locator('.crumb.current').textContent()).toBe('Demo Galaxy')
    await page.waitForTimeout(800)
    await page.mouse.click(c.x + c.width * 0.25, c.y + c.height * 0.3)
    await page.locator('.insp-title', { hasText: 'Gone Two' }).waitFor()
    expect(errors).toEqual([])
  })

  it('a planet far bigger than its star still shows (capped) in a default-size system', async () => {
    const c = (await page.locator('.map-root canvas').boundingBox())!
    await page.mouse.dblclick(c.x + c.width * 0.25, c.y + c.height * 0.3) // enter Gone Two (size 6)
    await expect.poll(() => page.locator('.crumb.current').textContent(), { timeout: 8000 }).toBe('Gone Two')
    writeFileSync(join(vault, 'Atlas/Places/Huge.md'), '---\ntype: location\nparent: "[[Gone Two]]"\nmap_kind: planet\nmap_pos: [-45, 0, -20]\nmap_size: 6000\n---\n')
    writeFileSync(join(vault, 'Atlas/Places/Normal.md'), '---\ntype: location\nparent: "[[Gone Two]]"\nmap_kind: planet\nmap_pos: [30, 0, 25]\nmap_size: 6\n---\n')
    await page.locator('.loc-label', { hasText: 'Huge' }).first().waitFor({ state: 'attached' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'docs/shots/scale-huge-planet.png' })
  })

  it('Esc past the galaxy reaches Known space, where a universe can be added and the galaxy moved inside it', async () => {
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.crumb.current').textContent(), { timeout: 8000 }).toBe('Demo Galaxy')
    await page.waitForTimeout(600)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.map-title .t').textContent(), { timeout: 8000 }).toBe('Known space')
    await page.waitForTimeout(1200)
    await page.click('.add-kind .map-edit-btn')
    await page.locator('.add-kind-opt', { hasText: 'Universe' }).click()
    const c = (await page.locator('.map-root canvas').boundingBox())!
    await page.mouse.click(c.x + c.width * 0.75, c.y + c.height * 0.7)
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'docs/shots/known-space.png' })
    const dialog = page.locator('.place-dialog')
    await dialog.waitFor({ timeout: 4000 })
    await dialog.locator('input.field-input').first().fill('Big Everything')
    await dialog.locator('button[type=submit]').click()
    const u = join(vault, 'Atlas/Places/Big Everything.md')
    await expect.poll(() => existsSync(u)).toBe(true)
    expect(readFileSync(u, 'utf8')).toContain('map_kind: universe')
    expect(readFileSync(u, 'utf8')).not.toContain('parent:')
    await page.screenshot({ path: 'docs/shots/known-space.png' })
    // move the galaxy inside it from the Inspector
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('.palette-input').fill('Demo Galaxy')
    await page.keyboard.press('Enter')
    await page.locator('.insp-title', { hasText: 'Demo Galaxy' }).waitFor()
    await page.locator('.info-row', { hasText: 'Inside' }).locator('select').selectOption({ label: 'Big Everything · universe' })
    const g = [...['Atlas/Places/Demo Galaxy.md', 'World/Demo Galaxy.md', 'Demo Galaxy.md']].map((p) => join(vault, p)).find((p) => existsSync(p))
    if (g) await expect.poll(() => readFileSync(g, 'utf8')).toContain('[[Big Everything]]')
    await page.waitForTimeout(2500)
    await page.screenshot({ path: 'docs/shots/known-space-after.png' })
    expect(await page.locator('.crumbs .crumb').allTextContents()).toContain('Known space')
  })
})

describe('lanes from the lane area', () => {
  it('+ Add lane under the lanes adds one; × on a lane hides it', async () => {
    await page.click('button[aria-label="Timeline"]')
    await page.locator('.tl-axis').waitFor()
    await page.click('.tl-toolbar .seg button:has-text("Characters")')
    expect(await page.locator('.tl-lane[data-label="Chara"]').count()).toBe(0)
    await page.click('.add-lane-btn')
    await page.screenshot({ path: 'docs/shots/add-lane.png' })
    await page.locator('.add-lane-opt', { has: page.getByText('Chara', { exact: true }) }).click()
    await page.locator('.tl-lane[data-label="Chara"]').waitFor()
    await page.locator('.tl-lane[data-label="Chara"]').hover()
    await page.click('button[aria-label="Hide lane Chara"]')
    await expect.poll(() => page.locator('.tl-lane[data-label="Chara"]').count()).toBe(0)
    await page.click('.tl-toolbar .seg button:has-text("Main")')
    await page.click('.tl-addlane button:has-text("by place")')
    await page.locator('.add-lane-btn').waitFor()
  })
})
