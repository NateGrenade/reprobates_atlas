// Launch the built app with Playwright against a throwaway clone of dev-vault, with real mouse/keyboard input.
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
/** dev-vault commit the e2e tests run against. Nathan also uses dev-vault, so tests pin a known state. */
export const FIXTURE_COMMIT = process.env.ATLAS_E2E_COMMIT ?? 'bdfaf2d'

/** `reuse`: the `dir` of an earlier launch, to relaunch with the same vault and app settings (userData). */
export async function launch(reuse?: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; vault: string; dir: string }> {
  const dir = reuse ?? mkdtempSync(join(tmpdir(), 'atlas-e2e-'))
  const vault = join(dir, 'vault')
  if (!reuse) {
    execFileSync('git', ['clone', '-q', join(ROOT, 'dev-vault'), vault])
    execFileSync('git', ['-C', vault, 'remote', 'remove', 'origin'])
    execFileSync('git', ['-C', vault, 'checkout', '-q', FIXTURE_COMMIT])
  }
  const app = await electron.launch({
    args: [join(ROOT, 'out/main/index.js')],
    env: { ...process.env, ATLAS_VAULT: vault, ATLAS_USER_DATA: join(dir, 'userdata'), ATLAS_SCRIPT: '', ELECTRON_RENDERER_URL: '', ...env }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => null)
  await page.waitForSelector('.rail')
  return { app, page, vault, dir }
}
