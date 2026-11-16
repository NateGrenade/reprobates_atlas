import { contextBridge, ipcRenderer } from 'electron'

export type FileEntry = [path: string, text: string | null]
export type FileChange = [path: string, text: string | null | false] // false = deleted
export interface OpenedVault {
  root: string
  name: string
  files: FileEntry[]
  dirs: string[]
}

const api = {
  openVault: (which?: 'default' | 'pick'): Promise<OpenedVault | null> => ipcRenderer.invoke('vault:open', which),
  createNewVault: (name: string): Promise<OpenedVault | null> => ipcRenderer.invoke('vault:createNew', name),
  connectRemote: (url: string): Promise<any> => ipcRenderer.invoke('vault:connectRemote', url),
  changeRemote: (url: string): Promise<any> => ipcRenderer.invoke('vault:changeRemote', url),
  disconnectRemote: (): Promise<any> => ipcRenderer.invoke('vault:disconnectRemote'),
  write: (path: string, text: string): Promise<boolean> => ipcRenderer.invoke('vault:write', path, text),
  create: (path: string, text: string): Promise<boolean> => ipcRenderer.invoke('vault:create', path, text),
  mkdir: (path: string): Promise<boolean> => ipcRenderer.invoke('vault:mkdir', path),
  rename: (from: string, to: string): Promise<boolean> => ipcRenderer.invoke('vault:rename', from, to),
  writeBinary: (path: string, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('vault:writeBinary', path, data),
  trash: (path: string): Promise<boolean> => ipcRenderer.invoke('vault:trash', path),
  onDirs: (cb: (dirs: string[]) => void) => {
    const h = (_e: unknown, d: string[]) => cb(d)
    ipcRenderer.on('vault:dirs', h)
    return () => void ipcRenderer.removeListener('vault:dirs', h)
  },
  read: (path: string): Promise<string> => ipcRenderer.invoke('vault:read', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open', url),
  onChanged: (cb: (changes: FileChange[]) => void) => {
    const h = (_e: unknown, c: FileChange[]) => cb(c)
    ipcRenderer.on('vault:changed', h)
    return () => void ipcRenderer.removeListener('vault:changed', h)
  },
  sync: {
    get: (): Promise<any> => ipcRenderer.invoke('sync:get'),
    setMode: (m: 'auto' | 'manual' | 'off'): Promise<any> => ipcRenderer.invoke('sync:setMode', m),
    now: (): Promise<any> => ipcRenderer.invoke('sync:now'),
    publishExisting: (): Promise<any> => ipcRenderer.invoke('sync:publishExisting'),
    resolve: (p: string, side: 'mine' | 'theirs'): Promise<any> => ipcRenderer.invoke('sync:resolve', p, side),
    both: (p: string): Promise<{ mine: string; theirs: string } | null> => ipcRenderer.invoke('sync:both', p),
    activity: (): Promise<any[]> => ipcRenderer.invoke('sync:activity'),
    onStatus: (cb: (s: any) => void) => {
      const h = (_e: unknown, s: any) => cb(s)
      ipcRenderer.on('sync:status', h)
      return () => void ipcRenderer.removeListener('sync:status', h)
    }
  },
  update: {
    check: (): Promise<{ status: 'available' | 'up-to-date' | 'error' | 'development'; message?: string }> => ipcRenderer.invoke('update:check'),
    download: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
    onAvailable: (cb: (u: { version: string; notes?: string; action: 'download' | 'install-on-quit' }) => void) => {
      const h = (_e: unknown, u: any) => cb(u)
      ipcRenderer.on('update:available', h)
      return () => void ipcRenderer.removeListener('update:available', h)
    }
  },
  prefs: {
    get: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('prefs:get'),
    set: (patch: Record<string, unknown>): Promise<Record<string, unknown>> => ipcRenderer.invoke('prefs:set', patch)
  },
  revealVault: (): Promise<void> => ipcRenderer.invoke('vault:reveal'),
  info: (): Promise<{ version: string; packaged: boolean; platform: string }> => ipcRenderer.invoke('app:info'),
  gitVersion: (): Promise<string | null> => ipcRenderer.invoke('app:gitVersion'),
  cloneVault: (url: string): Promise<OpenedVault | null> => ipcRenderer.invoke('vault:clone', url),
  addons: {
    list: (): Promise<{ id: string; name: string; version?: string; description?: string; enabled: boolean; renderer: string | null }[]> => ipcRenderer.invoke('addons:list'),
    setEnabled: (id: string, on: boolean): Promise<any[]> => ipcRenderer.invoke('addons:setEnabled', id, on),
    invoke: (id: string, channel: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke('addons:invoke', id, channel, ...args),
    onEvent: (cb: (id: string, channel: string, data: unknown) => void) => {
      const h = (_e: unknown, id: string, channel: string, data: unknown) => cb(id, channel, data)
      ipcRenderer.on('addons:event', h)
      return () => void ipcRenderer.removeListener('addons:event', h)
    }
  },
  platform: process.platform,
  devFlags: { autozoom: process.env.ATLAS_AUTOZOOM === '1', script: !!process.env.ATLAS_SCRIPT }
}

export type AtlasApi = typeof api
contextBridge.exposeInMainWorld('atlas', api)
