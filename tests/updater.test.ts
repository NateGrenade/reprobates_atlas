import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), downloadURL: vi.fn(), checkForUpdates: vi.fn(),
  autoUpdater: { autoDownload: false, autoInstallOnAppQuit: false, checkForUpdates: vi.fn() }
}))
vi.mock('electron', () => ({ app: { getVersion: () => '1.2.3' }, net: { fetch: mocks.fetch } }))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))
import { MacNotifyUpdater, WinAutoUpdater } from '../src/main/updater'

const win = () => ({ webContents: { downloadURL: mocks.downloadURL } }) as any
const response = (release: object, status = 200) => ({ ok: status === 200, status, json: async () => release })
const suitable = process.arch === 'arm64' ? 'Atlas-arm64.dmg' : 'Atlas-x64.dmg'
const unsuitable = process.arch === 'arm64' ? 'Atlas-x64.dmg' : 'Atlas-arm64.dmg'
const asset = { name: suitable, browser_download_url: 'https://example.com/atlas.dmg' }
beforeEach(() => { vi.clearAllMocks(); mocks.autoUpdater.autoDownload = false; mocks.autoUpdater.autoInstallOnAppQuit = false })

describe('Mac updates', () => {
  it('compares semantic versions including prereleases', async () => {
    const updater = new MacNotifyUpdater(win)
    for (const tag_name of ['v1.2.3', '1.2.3-rc.1', '1.2.2', '1.2.3+build.8']) {
      mocks.fetch.mockResolvedValueOnce(response({ tag_name }))
      expect(await updater.check()).toBeNull()
    }
    mocks.fetch.mockResolvedValueOnce(response({ tag_name: 'v1.2.4-rc.1', assets: [asset] }))
    expect(await updater.check()).toMatchObject({ version: '1.2.4-rc.1', action: 'download' })
  })
  it('chooses the matching architecture and starts a download', async () => {
    mocks.fetch.mockResolvedValueOnce(response({ tag_name: 'v1.3.0', body: 'Changes', assets: [{ name: unsuitable, browser_download_url: 'wrong' }, asset] }))
    const updater = new MacNotifyUpdater(win)
    const info = await updater.check()
    expect(info).toEqual({ version: '1.3.0', notes: 'Changes', downloadUrl: asset.browser_download_url, action: 'download' })
    await updater.download(info!)
    expect(mocks.downloadURL).toHaveBeenCalledWith(asset.browser_download_url)
  })
  it('reports check errors, malformed versions, and missing compatible assets', async () => {
    const updater = new MacNotifyUpdater(win)
    mocks.fetch.mockResolvedValueOnce(response({}, 404))
    await expect(updater.check()).rejects.toThrow('HTTP 404')
    mocks.fetch.mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(updater.check()).rejects.toThrow('Network unavailable')
    mocks.fetch.mockResolvedValueOnce(response({ tag_name: 'not-a-version' }))
    await expect(updater.check()).rejects.toThrow('invalid version')
    mocks.fetch.mockResolvedValueOnce(response({ tag_name: '1.3.0', assets: [{ name: unsuitable, browser_download_url: 'wrong' }] }))
    await expect(updater.check()).rejects.toThrow('no compatible Mac download')
    await expect(new MacNotifyUpdater(() => null).download({ version: '1.3.0', action: 'download' })).rejects.toThrow('unavailable')
  })
})

describe('Windows updates', () => {
  it('announces install on quit only after download succeeds', async () => {
    let finish!: () => void
    const downloadPromise = new Promise<string[]>((resolve) => { finish = () => resolve(['installer.exe']) })
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: '1.3.0' }, downloadPromise })
    const updater = new WinAutoUpdater()
    let completed = false
    const pending = updater.check().then((result) => { completed = true; return result })
    await vi.waitFor(() => expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalled())
    expect(completed).toBe(false)
    finish()
    expect(await pending).toEqual({ version: '1.3.0', action: 'install-on-quit' })
    expect(mocks.autoUpdater.autoDownload).toBe(true)
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)
  })
  it('reports failed or missing downloads and skips an up-to-date result', async () => {
    const updater = new WinAutoUpdater()
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.2.3' } })
    expect(await updater.check()).toBeNull()
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: '1.3.0' }, downloadPromise: null })
    await expect(updater.check()).rejects.toThrow('did not start')
    mocks.autoUpdater.checkForUpdates.mockImplementationOnce(async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.3.0' }, downloadPromise: Promise.reject(new Error('Download failed')) }))
    await expect(updater.check()).rejects.toThrow('Download failed')
  })
})
