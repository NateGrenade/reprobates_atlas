import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { launch } from './harness'

const artifacts = '/tmp/atlas-writer-validation'
let app: ElectronApplication, page: Page, vault: string, dir: string, mcp: Client
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await mcp.callTool({ name, arguments: args })
  const t = r.content.find((c: any) => c.type === 'text')?.text
  return { error: !!r.isError, value: t && !r.isError ? JSON.parse(t) : t }
}
beforeAll(async () => {
  mkdirSync(artifacts, { recursive: true })
  rmSync(join(artifacts, 'codex-args.txt'), { force: true })
  const fake = join(artifacts, 'codex')
  const shell = join(artifacts, 'shell')
  writeFileSync(fake, `#!/bin/sh\nif [ "$1" = login ]; then echo 'Logged in using ChatGPT'; exit; fi\nprintf '%s\\n' "$@" > '${artifacts}/codex-args.txt'\necho '{"type":"thread.started","thread_id":"fixture"}'\necho '{"type":"item.completed","item":{"type":"agent_message","text":"Fixture response"}}'\n`, { mode: 0o755 })
  writeFileSync(shell, `#!/bin/sh\ncase "$2" in *codex*) echo '${fake}';; esac\n`, { mode: 0o755 })
  ;({ app, page, vault, dir } = await launch(undefined, { ATLAS_ADDONS_DIR: join(artifacts, 'addons'), SHELL: shell }))
  for (let i = 0; i < 50 && !existsSync(join(dir, 'userdata/live.json')); i++) await page.waitForTimeout(100)
  const { url } = JSON.parse(readFileSync(join(dir, 'userdata/live.json'), 'utf8'))
  mcp = new Client({ name: 'assistant-controls-e2e', version: '1' })
  await mcp.connect(new StreamableHTTPClientTransport(new URL(url)))
})
afterAll(async () => { await mcp?.close(); await app?.close() })

describe('assistant controls and approvals', () => {
  it('selects and persists Codex model and effort, then passes them to the CLI', async () => {
    await page.keyboard.press('ControlOrMeta+j')
    await page.locator('.asst-foot button:has-text("Codex")').click()
    await page.locator('.asst-model-wrap > button').click()
    const model = page.locator('.asst-model-menu select').nth(0)
    await expect.poll(() => model.locator('option').count()).toBeGreaterThan(1)
    await model.click()
    await model.selectOption('gpt-6-luna')
    const effort = page.locator('.asst-model-menu select').nth(1)
    await effort.click()
    await effort.selectOption('high')
    await page.screenshot({ path: join(artifacts, 'assistant-model-menu.png') })
    await page.locator('.asst-model-wrap > button').click()
    await page.locator('.asst-bar textarea').fill('Hello')
    await page.locator('.asst-foot button.send').click()
    await expect.poll(() => existsSync(join(artifacts, 'codex-args.txt'))).toBe(true)
    const args = readFileSync(join(artifacts, 'codex-args.txt'), 'utf8')
    expect(args).toContain('gpt-6-luna')
    expect(args).toContain('model_reasoning_effort="high"')
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('assistant.choices') || '{}')).codex).toEqual({ model: 'gpt-6-luna', effort: 'high' })
    await expect.poll(() => page.locator('.asst-reply').textContent()).toContain('Fixture response')
    await page.reload()
    await page.locator('.rail').waitFor()
    await page.keyboard.press('ControlOrMeta+j')
    await page.locator('.asst-model-wrap > button').click()
    await expect.poll(() => page.locator('.asst-model-menu select').nth(0).inputValue()).toBe('gpt-6-luna')
    expect(await page.locator('.asst-model-menu select').nth(1).inputValue()).toBe('high')
  })
  it('shows and applies or skips precise file proposals via the approval card', async () => {
    const path = 'Atlas/Places/Assistant-Test.md'
    const create = call('create_file', { path, content: '# Initial\n' })
    await page.locator('.live-ask').waitFor()
    await page.screenshot({ path: join(artifacts, 'assistant-file-approval.png') })
    expect(existsSync(join(vault, path))).toBe(false)
    await page.locator('.live-ask button:has-text("Apply")').click()
    expect((await create).value.saved).toBe(true)
    expect(readFileSync(join(vault, path), 'utf8')).toBe('# Initial\n')
    const edit = call('edit_file', { path, before: 'Initial', after: 'Revised' })
    await page.locator('.live-ask').waitFor()
    expect(await page.locator('.live-ask li').allTextContents()).toEqual(['Replace:', 'Initial', 'With:', 'Revised'])
    await page.locator('.live-ask button:has-text("Skip")').click()
    expect((await edit).value.saved).toBe(false)
    expect(readFileSync(join(vault, path), 'utf8')).toBe('# Initial\n')
    const apply = call('edit_file', { path, before: 'Initial', after: 'Revised' })
    await page.locator('.live-ask button:has-text("Apply")').click()
    expect((await apply).value.saved).toBe(true)
    expect(readFileSync(join(vault, path), 'utf8')).toBe('# Revised\n')
  })
  it('previews a planet and saves it only after clicking Apply', async () => {
    const path = 'Atlas/Places/potato.md'
    const scene = join(vault, 'Atlas/Maps/potato.scene.json')
    expect((await call('preview_scene', { path, params: { ice: 0.7 } })).error).toBe(false)
    expect(existsSync(scene)).toBe(false)
    const save = call('apply_scene', { path })
    await page.locator('.live-ask').waitFor()
    await page.screenshot({ path: join(artifacts, 'assistant-scene-approval.png') })
    await page.locator('.live-ask button:has-text("Apply")').click()
    expect((await save).value.saved).toBe(true)
    expect(JSON.parse(readFileSync(scene, 'utf8')).params.ice).toBe(0.7)
  })
})
