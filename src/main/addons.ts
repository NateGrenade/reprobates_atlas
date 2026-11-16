// Add-on host, main side (plan/next.md, piece 2). An add-on is a folder with addon.json, renderer.js and
// an optional main.js. Folders are read from <userData>/addons, plus the add-ons bundled into a personal build.
import { app, ipcMain, type BrowserWindow } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface AddonManifest {
  id: string
  name: string
  version?: string
  description?: string
  entry?: { renderer?: string; main?: string }
}
interface Found extends AddonManifest {
  dir: string
}
/** What an add-on's main.js gets: `export function activate(ctx)`. */
export interface AddonMainContext {
  /** answer `api.ipc.invoke(channel, ...args)` from this add-on's renderer side */
  handle(channel: string, fn: (...args: any[]) => unknown): void
  /** push an event to this add-on's renderer side (`api.ipc.on`) */
  send(channel: string, data?: unknown): void
  /** a folder for this add-on's own data */
  dataDir: string
  /** address of the Atlas Live MCP server, or null before it is up */
  liveUrl(): string | null
  /** absolute path of the open vault, or null */
  vaultRoot(): string | null
  /** Record vault-relative files this add-on wrote for Git sync. */
  recordWrite(...paths: string[]): void
}

const found = new Map<string, Found>()
const handlers = new Map<string, (...args: any[]) => unknown>()
const activated = new Set<string>()

function roots(): string[] {
  const r = [join(app.getPath('userData'), 'addons')]
  // bundled add-ons: a personal build ships them in out/addons; in development set ATLAS_ADDONS_DIR
  if (process.env.ATLAS_ADDONS_DIR) r.push(resolve(process.env.ATLAS_ADDONS_DIR))
  else if (app.isPackaged) r.push(join(app.getAppPath(), 'out/addons'))
  return r
}

function scan() {
  found.clear()
  for (const root of roots()) {
    if (!existsSync(root)) continue
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      try {
        const m = JSON.parse(readFileSync(join(root, d.name, 'addon.json'), 'utf8')) as AddonManifest
        if (typeof m.id === 'string' && /^[a-z0-9-]+$/.test(m.id) && !found.has(m.id)) found.set(m.id, { ...m, name: m.name ?? m.id, dir: join(root, d.name) })
      } catch {
        // not an add-on folder
      }
    }
  }
}

/** File inside an add-on folder, for atlas://addon/<id>/<file>. */
export function addonFile(id: string, file: string): string {
  const a = found.get(id)
  if (!a) throw new Error(`No add-on: ${id}`)
  const abs = resolve(a.dir, file)
  if (!abs.startsWith(a.dir + sep)) throw new Error('Path escapes the add-on')
  return abs
}

export function setupAddons(o: { win: () => BrowserWindow | null; disabled: () => string[]; setDisabled: (ids: string[]) => void; liveUrl: () => string | null; vaultRoot: () => string | null; recordWrite: (...paths: string[]) => void }) {
  scan()
  const activate = async (a: Found) => {
    if (!a.entry?.main || activated.has(a.id)) return
    activated.add(a.id)
    try {
      const mod = await import(pathToFileURL(join(a.dir, a.entry.main)).href)
      await mod.activate?.({
        handle: (channel, fn) => handlers.set(`${a.id}:${channel}`, fn),
        send: (channel, data) => o.win()?.webContents.send('addons:event', a.id, channel, data),
        dataDir: join(app.getPath('userData'), 'addon-data', a.id),
        liveUrl: o.liveUrl,
        vaultRoot: o.vaultRoot,
        recordWrite: o.recordWrite
      } satisfies AddonMainContext)
    } catch (e) {
      console.error(`[addon ${a.id}] main failed to start:`, e)
    }
  }
  const list = () => [...found.values()].map((a) => ({ id: a.id, name: a.name, version: a.version, description: a.description, enabled: !o.disabled().includes(a.id), renderer: a.entry?.renderer ? `atlas://addon/${a.id}/${a.entry.renderer}` : null }))
  for (const a of found.values()) if (!o.disabled().includes(a.id)) void activate(a)
  ipcMain.handle('addons:list', () => list())
  ipcMain.handle('addons:setEnabled', async (_e, id: string, on: boolean) => {
    o.setDisabled(on ? o.disabled().filter((x) => x !== id) : [...new Set([...o.disabled(), id])])
    const a = found.get(id)
    if (on && a) await activate(a)
    return list()
  })
  ipcMain.handle('addons:invoke', async (_e, id: string, channel: string, ...args: unknown[]) => {
    if (o.disabled().includes(id)) throw new Error(`Add-on ${id} is turned off`)
    const h = handlers.get(`${id}:${channel}`)
    if (!h) throw new Error(`Add-on ${id} has no handler for ${channel}`)
    return h(...args)
  })
}
