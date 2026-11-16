// Windows downloads updates for installation on quit. The unsigned Mac build downloads a DMG for manual replacement.
import { app, net, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'

const semver: { valid(v: string): string | null; gt(a: string, b: string): boolean } = createRequire(import.meta.url)('semver')
export const UPDATE_REPO = process.env.ATLAS_UPDATE_REPO ?? 'NateGrenade/reprobates_atlas'

export interface UpdateInfo {
  version: string
  notes?: string
  downloadUrl?: string
  action: 'download' | 'install-on-quit'
}
export interface Updater {
  check(): Promise<UpdateInfo | null>
  download(info: UpdateInfo): Promise<void>
}

function newer(version: string, current: string): boolean {
  const next = semver.valid(version), installed = semver.valid(current)
  if (!next || !installed) throw new Error('The update feed contains an invalid version.')
  return semver.gt(next, installed)
}

/** Mac: GitHub Releases API (or ATLAS_UPDATE_FEED pointing at equivalent JSON for testing). */
export class MacNotifyUpdater implements Updater {
  constructor(private win: () => BrowserWindow | null) {}
  async check(): Promise<UpdateInfo | null> {
    const url = process.env.ATLAS_UPDATE_FEED ?? `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
    const res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`Update check failed (HTTP ${res.status}).`)
    const rel = (await res.json()) as { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] }
    if (!rel.tag_name || !semver.valid(rel.tag_name)) throw new Error('The update feed contains an invalid version.')
    if (!newer(rel.tag_name, app.getVersion())) return null
    const assets = (rel.assets ?? []).filter((a) => /\.dmg$/i.test(a.name) && a.browser_download_url)
    const own = process.arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|intel/i
    const other = process.arch === 'arm64' ? /x64|x86_64|intel/i : /arm64|aarch64/i
    const dmg = assets.find((a) => own.test(a.name)) ?? assets.find((a) => /universal/i.test(a.name)) ?? assets.find((a) => !other.test(a.name) && !own.test(a.name))
    if (!dmg) throw new Error('The latest release has no compatible Mac download.')
    return { version: semver.valid(rel.tag_name)!, notes: rel.body, downloadUrl: dmg.browser_download_url, action: 'download' }
  }
  async download(info: UpdateInfo) {
    const window = this.win()
    if (!window || !info.downloadUrl) throw new Error('The update download is unavailable.')
    window.webContents.downloadURL(info.downloadUrl)
  }
}

/** Windows: wait for the automatic download so the notice can truthfully say it will install on quit. */
export class WinAutoUpdater implements Updater {
  async check(): Promise<UpdateInfo | null> {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable || !newer(result.updateInfo.version, app.getVersion())) return null
    if (!result.downloadPromise) throw new Error('The update download did not start.')
    await result.downloadPromise
    return { version: result.updateInfo.version, action: 'install-on-quit' }
  }
  async download() {
    throw new Error('The update is already downloaded and will install when you quit.')
  }
}

export function makeUpdater(win: () => BrowserWindow | null): Updater {
  return process.platform === 'win32' ? new WinAutoUpdater() : new MacNotifyUpdater(win)
}
