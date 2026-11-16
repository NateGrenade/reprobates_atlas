import { afterAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ROOT } from './harness'

let app: ElectronApplication
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
afterAll(async () => { await app?.close() })

describe('new vault connection', () => {
  it('creates a vault, connects without uploading, publishes explicitly, and pulls in Auto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-connect-ui-'))
    const remote = join(dir, 'remote.git'), vault = join(dir, 'New World')
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
    app = await electron.launch({ args: [join(ROOT, 'out/main/index.js')], env: { ...process.env, ATLAS_VAULT: join(dir, 'missing'), ATLAS_USER_DATA: join(dir, 'userdata'), ATLAS_SCRIPT: '', ELECTRON_RENDERER_URL: '' } })
    await app.evaluate(({ dialog }, parent) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent], bookmarks: [] }) }, dir)
    const page = await app.firstWindow()
    await page.getByLabel('New vault name').fill('New World')
    await page.getByRole('button', { name: 'Create…' }).click()
    await page.locator('.rail').waitFor()
    expect(existsSync(vault)).toBe(true)
    writeFileSync(join(vault, 'Story.md'), 'Existing chapter\n')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByLabel('Vault repository URL').fill(remote)
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect.poll(() => page.getByRole('radio', { name: 'Manual' }).getAttribute('aria-checked')).toBe('true')
    expect(git(dir, '--git-dir', remote, 'for-each-ref').trim()).toBe('')
    git(vault, 'config', 'user.name', 'Atlas Test')
    git(vault, 'config', 'user.email', 'atlas-test@example.com')
    await page.getByRole('button', { name: 'Publish existing files…' }).click()
    await page.getByRole('button', { name: 'Publish vault' }).click()
    await expect.poll(() => git(dir, '--git-dir', remote, 'for-each-ref').trim().length).toBeGreaterThan(0)
    expect(git(dir, '--git-dir', remote, 'show', 'main:Story.md')).toBe('Existing chapter\n')
    const clone = join(dir, 'other')
    git(dir, 'clone', '-q', remote, clone)
    git(clone, 'config', 'user.name', 'Other')
    git(clone, 'config', 'user.email', 'other@example.com')
    writeFileSync(join(clone, 'Story.md'), 'Updated remotely\n')
    git(clone, 'add', 'Story.md'); git(clone, 'commit', '-qm', 'Remote update'); git(clone, 'push', '-q')
    await page.evaluate(() => { (window as any).__vaultChanges = []; window.atlas.onChanged(changes => (window as any).__vaultChanges.push(...changes)) })
    await page.getByRole('radio', { name: 'Auto' }).click()
    await expect.poll(() => readFileSync(join(vault, 'Story.md'), 'utf8')).toBe('Updated remotely\n')
    await expect.poll(() => page.evaluate(() => (window as any).__vaultChanges.some((c: any[]) => c[0] === 'Story.md' && c[1] === 'Updated remotely\n'))).toBe(true)
    await page.screenshot({ path: '/tmp/atlas-writer-validation/vault-sync-settings.png' })
    await page.getByRole('radio', { name: 'Manual' }).click()
    await expect.poll(() => page.getByRole('radio', { name: 'Manual' }).getAttribute('aria-checked')).toBe('true')
    await app.close()
    app = await electron.launch({ args: [join(ROOT, 'out/main/index.js')], env: { ...process.env, ATLAS_VAULT: vault, ATLAS_USER_DATA: join(dir, 'userdata'), ATLAS_SCRIPT: '', ELECTRON_RENDERER_URL: '' } })
    const reopened = await app.firstWindow()
    await reopened.locator('.rail').waitFor()
    await reopened.getByRole('button', { name: 'Settings' }).click()
    await expect.poll(() => reopened.locator('.prefs-path').allTextContents()).toContain(remote)
    await expect.poll(() => reopened.getByRole('radio', { name: 'Manual' }).getAttribute('aria-checked')).toBe('true')
  })
})
