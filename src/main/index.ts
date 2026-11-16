import { createHash } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { startLive } from './live'
import { addonFile, setupAddons } from './addons'
import { join, resolve, dirname, sep } from 'node:path'
import { mkdir, readFile, writeFile, stat, rename, access } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { scanVault, watchVault, type VaultWatcher } from '../../core/node'
import { APP_NAME, PATHS } from '../../core/config'
import readmeTemplate from '../../templates/Atlas/README.md?raw'
import configTemplate from '../../templates/Atlas/atlas.yaml?raw'
import { connectRemote, disconnectRemote, SyncEngine, type SyncMode } from '../../core/sync'
import { makeUpdater, type UpdateInfo } from './updater'
import { execFile } from 'node:child_process'

// Tests can isolate settings (sync mode, last vault) from the real profile
if (process.env.ATLAS_USER_DATA) app.setPath('userData', process.env.ATLAS_USER_DATA)

// Dev measurement runs must keep rendering even when the window is covered.
if (process.env.ATLAS_SHOT || process.env.ATLAS_AUTOZOOM || process.env.ATLAS_SCRIPT) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

protocol.registerSchemesAsPrivileged([{ scheme: 'atlas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

const TEXT_EXT = /\.(md|ya?ml|json|base|canvas)$/i
let win: BrowserWindow | null = null
let vaultRoot: string | null = null
let watcher: VaultWatcher | null = null
let sync: SyncEngine | null = null
const syncKey = (root: string) => `sync:${root}`
const recordWrite = (...paths: string[]) => sync?.recordWrite(...paths)
/** Paths the app itself wrote recently: their watcher echoes are skipped. */
const ownWrites = new Map<string, number>()

const settingsFile = () => join(app.getPath('userData'), 'settings.json')
function loadSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}
function saveSettings(patch: Record<string, unknown>) {
  writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...patch }, null, 2))
}

/** In development the vault is always the repo's dev-vault unless picked in-session; nothing is persisted. */
function defaultVault(): string | null {
  if (process.env.ATLAS_VAULT) return resolve(process.env.ATLAS_VAULT)
  if (!app.isPackaged) return resolve(app.getAppPath(), 'dev-vault')
  const last = loadSettings().lastVault
  return typeof last === 'string' && existsSync(last) ? last : null
}

function inVault(p: string): string {
  if (!vaultRoot) throw new Error('No vault open')
  const abs = resolve(vaultRoot, p)
  if (abs !== vaultRoot && !abs.startsWith(vaultRoot + sep)) throw new Error(`Path escapes vault: ${p}`)
  return abs
}

async function openVault(root: string) {
  await watcher?.close()
  sync?.stop()
  sync = null
  vaultRoot = root
  if (existsSync(join(root, '.git'))) {
    const mode = (loadSettings()[syncKey(root)] as SyncMode) ?? 'auto'
    sync = new SyncEngine(root, { mode, pendingFile: join(app.getPath('userData'), 'sync-pending', createHash('sha256').update(root).digest('hex') + '.json'), onStatus: (s) => win?.webContents.send('sync:status', s) })
    // Read local metadata even in Manual/Off so Settings reflects the actual remote after a restart.
    const remote = await sync.git(['config', '--get', 'remote.origin.url']).catch(() => '')
    if (remote.trim()) sync.setRemote(remote.trim())
    sync.start()
  }
  if (app.isPackaged) saveSettings({ lastVault: root })
  // First open: add Atlas metadata only; existing notes are left untouched.
  for (const [p, text] of [[PATHS.readme, readmeTemplate], [PATHS.config, configTemplate]] as const) {
    const abs = join(root, p)
    if (!existsSync(abs)) {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
    }
  }
  const dirs = new Set<string>()
  const files = await scanVault(root, dirs)
  watcher = watchVault(root, async (paths) => {
    const now = Date.now()
    const changes: [string, string | null | false][] = []
    let structural = false
    for (const p of paths) {
      const t = ownWrites.get(p)
      if (t && now - t < 1500) continue
      const abs = inVault(p)
      try {
        const s = await stat(abs)
        if (s.isDirectory()) structural = true
        if (!s.isFile()) continue
        changes.push([p, TEXT_EXT.test(p) ? await readFile(abs, 'utf8') : null])
      } catch {
        structural = true
        changes.push([p, false]) // deleted (file or folder)
      }
    }
    if (structural) {
      const d = new Set<string>()
      await scanVault(root, d).catch(() => null)
      win?.webContents.send('vault:dirs', [...d])
    }
    if (changes.length) win?.webContents.send('vault:changed', changes)
  })
  return { root, name: root.split(sep).pop(), files: [...files.entries()], dirs: [...dirs] }
}

ipcMain.handle('vault:open', async (_e, which?: 'default' | 'pick') => {
  let root = which === 'pick' ? null : vaultRoot ?? defaultVault()
  if (!root && which !== 'pick') return null
  if (which === 'pick') {
    const r = await dialog.showOpenDialog(win!, { title: 'Open your vault folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return vaultRoot ? openVault(vaultRoot) : null
    root = r.filePaths[0]
  }
  if (!root || !existsSync(root)) return null
  return openVault(root)
})

ipcMain.handle('vault:write', async (_e, p: string, text: string) => {
  const abs = inVault(p)
  await mkdir(dirname(abs), { recursive: true })
  ownWrites.set(p, Date.now())
  await writeFile(abs, text, 'utf8')
  recordWrite(p)
  return true
})

const exists = (abs: string) => access(abs).then(() => true, () => false)

ipcMain.handle('vault:create', async (_e, p: string, text: string) => {
  const abs = inVault(p)
  if (await exists(abs)) throw new Error(`Already exists: ${p}`)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
  recordWrite(p)
  return true
})
ipcMain.handle('vault:mkdir', async (_e, p: string) => {
  const abs = inVault(p)
  if (await exists(abs)) throw new Error(`Already exists: ${p}`)
  await mkdir(abs, { recursive: true })
  return true
})
ipcMain.handle('vault:rename', async (_e, from: string, to: string) => {
  const a = inVault(from), b = inVault(to)
  if (a === b) return true
  // allow case-only renames on case-insensitive disks
  if ((await exists(b)) && a.toLowerCase() !== b.toLowerCase()) throw new Error(`Already exists: ${to}`)
  await mkdir(dirname(b), { recursive: true })
  // record every file under a moved folder on both sides
  const before = (await scanVault(vaultRoot!).catch(() => new Map())) as Map<string, unknown>
  await rename(a, b)
  const moved = [...before.keys()].filter((k) => k === from || k.startsWith(from + '/'))
  recordWrite(...moved, ...moved.map((k) => to + k.slice(from.length)))
  return true
})
ipcMain.handle('vault:writeBinary', async (_e, p: string, data: Uint8Array) => {
  const abs = inVault(p)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, Buffer.from(data))
  recordWrite(p)
  return true
})
ipcMain.handle('vault:trash', async (_e, p: string) => {
  const before = (await scanVault(vaultRoot!).catch(() => new Map())) as Map<string, unknown>
  await shell.trashItem(inVault(p))
  recordWrite(...[...before.keys()].filter((k) => k === p || k.startsWith(p + '/')))
  return true
})

ipcMain.handle('sync:get', () => sync?.status() ?? null)
ipcMain.handle('sync:setMode', (_e, mode: SyncMode) => {
  if (!sync || !vaultRoot) return null
  saveSettings({ [syncKey(vaultRoot)]: mode })
  sync.setMode(mode)
  return sync.status()
})
ipcMain.handle('sync:publishExisting', async () => (sync ? (await sync.publishExisting(), sync.status()) : null))
ipcMain.handle('sync:now', async () => (sync ? (await sync.sync(), sync.status()) : null))
ipcMain.handle('sync:resolve', async (_e, p: string, side: 'mine' | 'theirs') => (sync ? (await sync.resolve(p, side), sync.status()) : null))
ipcMain.handle('sync:both', (_e, p: string) => sync?.both(p) ?? null)
ipcMain.handle('sync:activity', () => sync?.activity() ?? [])

// ---- updates (D7)
const updater = makeUpdater(() => win)
let pendingUpdate: UpdateInfo | null = null
async function checkForUpdate() {
  if (!app.isPackaged && !process.env.ATLAS_UPDATE_FEED) return { status: 'development', message: 'App updates are available in the installed release.' }
  try {
    pendingUpdate = await updater.check()
    if (pendingUpdate) win?.webContents.send('update:available', pendingUpdate)
    return pendingUpdate ? { status: 'available', update: pendingUpdate } : { status: 'up-to-date' }
  } catch (e) {
    return { status: 'error', message: String((e as Error)?.message ?? e) }
  }
}
ipcMain.handle('update:check', checkForUpdate)
ipcMain.handle('update:download', async () => {
  if (pendingUpdate) await updater.download(pendingUpdate)
  return !!pendingUpdate
})
ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, platform: process.platform }))
ipcMain.handle('app:gitVersion', () => new Promise((res) => execFile('git', ['--version'], (err, out) => res(err ? null : out.trim()))))
ipcMain.handle('vault:createNew', async (_e, name: string) => {
  const folder = name.trim()
  if (!folder || folder === '.' || folder === '..' || /[/\\\0]/.test(folder)) throw new Error('Enter a simple folder name')
  const choice = await dialog.showOpenDialog(win!, { title: 'Choose where to create the vault', properties: ['openDirectory', 'createDirectory'] })
  if (choice.canceled || !choice.filePaths[0]) return null
  const root = join(choice.filePaths[0], folder)
  await mkdir(root)
  return openVault(root)
})
ipcMain.handle('vault:connectRemote', async (_e, url: string) => {
  if (!vaultRoot) throw new Error('Open a vault first')
  const root = vaultRoot
  const previous = sync
  previous?.stop()
  await previous?.idle()
  try {
    await connectRemote(root, url)
    saveSettings({ [syncKey(root)]: 'manual' })
    await openVault(root)
    sync!.setRemote(url.trim())
    return sync!.status()
  } catch (error) {
    previous?.start()
    throw error
  }
})
ipcMain.handle('vault:changeRemote', async (_e, url: string) => {
  if (!vaultRoot) throw new Error('Open a vault first')
  const root = vaultRoot, previous = sync
  previous?.stop()
  await previous?.idle()
  try {
    await connectRemote(root, url, true)
    saveSettings({ [syncKey(root)]: 'manual' })
    await openVault(root)
    sync!.setRemote(url.trim())
    return sync!.status()
  } catch (error) { previous?.start(); throw error }
})
ipcMain.handle('vault:disconnectRemote', async () => {
  if (!vaultRoot || !sync) throw new Error('No repository connected')
  const root = vaultRoot, previous = sync
  previous.stop()
  await previous.idle()
  try {
    await disconnectRemote(root)
    saveSettings({ [syncKey(root)]: 'manual' })
    await openVault(root)
    sync!.setRemote(undefined)
    return sync!.status()
  } catch (error) { previous.start(); throw error }
})
ipcMain.handle('vault:clone', async (_e, url: string) => {
  const r = await dialog.showOpenDialog(win!, { title: 'Choose where to put the vault', properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  const name = url.replace(/\.git$/, '').split('/').pop() || 'vault'
  const dest = join(r.filePaths[0], name)
  await new Promise<void>((res, rej) => execFile('git', ['clone', url, dest], (err, _o, se) => (err ? rej(new Error(se || err.message)) : res())))
  return openVault(dest)
})

// App-level preferences (not the vault's): text size, motion, launch view. Stored in userData settings.json.
ipcMain.handle('prefs:get', () => (loadSettings().prefs as Record<string, unknown>) ?? {})
ipcMain.handle('prefs:set', (_e, patch: Record<string, unknown>) => {
  const next = { ...((loadSettings().prefs as Record<string, unknown>) ?? {}), ...patch }
  saveSettings({ prefs: next })
  return next
})
ipcMain.handle('vault:reveal', async () => {
  if (vaultRoot) await shell.openPath(vaultRoot)
})

ipcMain.handle('vault:read', async (_e, p: string) => readFile(inVault(p), 'utf8'))
ipcMain.handle('shell:open', async (_e, url: string) => {
  if (/^(obsidian|https?):/.test(url)) await shell.openExternal(url)
})

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#07060d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false, contextIsolation: true, backgroundThrottling: !(process.env.ATLAS_SHOT || process.env.ATLAS_AUTOZOOM || process.env.ATLAS_SCRIPT) }
  })
  win.once('ready-to-show', () => win?.show())
  // the window only ever shows the app itself: links never navigate it or open new windows
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // update downloads go straight to Downloads (no save dialog), then the file is revealed
  win.webContents.session.on('will-download', (_e, item) => {
    const dir = process.env.ATLAS_DOWNLOAD_DIR ?? app.getPath('downloads')
    item.setSavePath(join(dir, item.getFilename()))
    item.once('done', (_ev, state) => {
      console.log('[atlas] download', state, item.getSavePath())
      if (state === 'completed' && !process.env.ATLAS_DOWNLOAD_DIR) shell.showItemInFolder(item.getSavePath())
    })
  })
  win.webContents.once('did-finish-load', () => {
    setTimeout(checkForUpdate, 3000)
    const updates = setInterval(checkForUpdate, 6 * 60 * 60 * 1000)
    win?.once('closed', () => clearInterval(updates))
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  // Dev hooks: ATLAS_SHOT=<png> captures the window after ATLAS_SHOT_DELAY ms and quits.
  if (process.env.ATLAS_SHOT) {
    const out = resolve(process.env.ATLAS_SHOT)
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        await mkdir(dirname(out), { recursive: true })
        await writeFile(out, img.toPNG())
        console.log('[atlas] screenshot saved', out)
        if (!process.env.ATLAS_KEEP_OPEN) app.quit()
      }, Number(process.env.ATLAS_SHOT_DELAY ?? 5000))
    })
  }
  // Dev hook: ATLAS_SCRIPT=<file.js> runs an async script in the renderer after load and prints its result.
  if (process.env.ATLAS_SCRIPT) {
    const src = readFileSync(resolve(process.env.ATLAS_SCRIPT), 'utf8')
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const r = await win!.webContents.executeJavaScript(`(async () => { ${src} })()`)
          console.log('[atlas-script] result', JSON.stringify(r))
        } catch (e) {
          console.log('[atlas-script] error', String(e))
        }
        if (!process.env.ATLAS_SHOT && !process.env.ATLAS_KEEP_OPEN) app.quit()
      }, Number(process.env.ATLAS_SCRIPT_DELAY ?? 2500))
    })
  }
  win.webContents.on('console-message', (e) => {
    if (process.env.ATLAS_LOG_CONSOLE) console.log('[renderer]', e.message)
  })
}

app.whenReady().then(() => {
  let liveUrl: string | null = null
  void startLive(() => win).then((l) => (liveUrl = l.url))
  setupAddons({
    win: () => win,
    disabled: () => (loadSettings().addonsDisabled as string[]) ?? [],
    setDisabled: (ids) => saveSettings({ addonsDisabled: ids }),
    liveUrl: () => liveUrl,
    vaultRoot: () => vaultRoot,
    recordWrite
  })
  protocol.handle('atlas', async (req) => {
    // atlas://vault/<vault-relative path>
    const u = new URL(req.url)
    const p = decodeURIComponent(u.pathname.replace(/^\//, ''))
    // atlas://addon/<id>/<file inside that add-on's folder>
    if (u.host === 'addon') {
      const [id, ...rest] = p.split('/')
      const res = await net.fetch(pathToFileURL(addonFile(id, rest.join('/'))).toString())
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' } })
    }
    // CORS header so WebGL can use vault images and models as textures
    const res = await net.fetch(pathToFileURL(inVault(p)).toString())
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
