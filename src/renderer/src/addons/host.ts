// Add-on host, renderer side (plan/next.md, piece 2). Loads each enabled add-on's renderer.js and hands it `api`.
// An add-on is `export default function activate(api) { ...; return dispose? }` and uses nothing but `api`.
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { useStore } from '../store'
import { registerAddon, registerSettingsSection } from '../settings/registry'

export interface AddonView {
  id: string
  title: string
  icon?: ReactNode
  component: ComponentType
}
export interface AddonCommand {
  id: string
  title: string
  detail?: string
  /** e.g. 'mod+j' (mod = Cmd on macOS, Ctrl elsewhere), 'mod+shift+p' */
  shortcut?: string
  run(): void
}
export interface AddonOverlay {
  id: string
  component: ComponentType
}
export interface AddonApi {
  id: string
  /** the host's React; add-on bundles must use this copy, not their own */
  React: typeof React
  views: { register(v: AddonView): () => void; show(id: string): void }
  settings: { register(s: { title: string; icon?: ReactNode; render: () => ReactNode }): () => void }
  commands: { register(c: AddonCommand): () => void }
  /** floating UI drawn above every view */
  overlays: { register(o: AddonOverlay): () => void }
  /** talk to this add-on's own main.js */
  ipc: { invoke(channel: string, ...args: unknown[]): Promise<any>; on(channel: string, cb: (data: any) => void): () => void }
  /** read-only access to app state (zustand store) */
  store: typeof useStore
  toast(message: string): void
}

interface State {
  views: (AddonView & { addon: string })[]
  commands: (AddonCommand & { addon: string })[]
  overlays: (AddonOverlay & { addon: string })[]
  list: { id: string; name: string; version?: string; description?: string; enabled: boolean; error?: string }[]
}
let state: State = { views: [], commands: [], overlays: [], list: [] }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
export const useAddonHost = () => useSyncExternalStore(subscribe, () => state)
export const addonHost = () => state
export const viewId = (addon: string, id: string) => `addon:${addon}/${id}`

const disposers = new Map<string, (() => void)[]>()
;(window as any).__atlasHost = { React, ReactDOM, jsxRuntime }

function apiFor(id: string): AddonApi {
  const own = disposers.get(id)!
  const track = (d: () => void) => (own.push(d), d)
  return {
    id,
    React,
    views: {
      register: (v) => {
        const item = { ...v, id: viewId(id, v.id), addon: id }
        set({ views: [...state.views.filter((x) => x.id !== item.id), item] })
        return track(() => {
          set({ views: state.views.filter((x) => x !== item) })
          if (useStore.getState().view === item.id) useStore.getState().setView('map')
        })
      },
      show: (v) => useStore.getState().setView(viewId(id, v) as any)
    },
    settings: { register: (s) => track(registerSettingsSection({ ...s, id: `addon.${id}`, order: 100 })) },
    commands: {
      register: (c) => {
        const item = { ...c, id: `${id}/${c.id}`, addon: id }
        set({ commands: [...state.commands.filter((x) => x.id !== item.id), item] })
        return track(() => set({ commands: state.commands.filter((x) => x !== item) }))
      }
    },
    overlays: {
      register: (o) => {
        const item = { ...o, id: `${id}/${o.id}`, addon: id }
        set({ overlays: [...state.overlays.filter((x) => x.id !== item.id), item] })
        return track(() => set({ overlays: state.overlays.filter((x) => x !== item) }))
      }
    },
    ipc: {
      invoke: (channel, ...args) => window.atlas.addons.invoke(id, channel, ...args),
      on: (channel, cb) => track(window.atlas.addons.onEvent((a, c, data) => a === id && c === channel && cb(data)))
    },
    store: useStore,
    toast: (m) => useStore.getState().showToast(m)
  }
}

function unload(id: string) {
  for (const d of disposers.get(id) ?? []) {
    try {
      d()
    } catch (e) {
      console.error(`[addon ${id}] dispose failed`, e)
    }
  }
  disposers.delete(id)
}

async function load(a: { id: string; name: string; version?: string; description?: string; renderer: string | null }): Promise<string | undefined> {
  if (disposers.has(a.id)) return
  disposers.set(a.id, [registerAddon({ id: a.id, name: a.name, version: a.version, description: a.description })])
  if (!a.renderer) return
  try {
    const mod = await import(/* @vite-ignore */ a.renderer)
    const dispose = await mod.default(apiFor(a.id))
    if (typeof dispose === 'function') disposers.get(a.id)?.push(dispose)
  } catch (e: any) {
    console.error(`[addon ${a.id}] failed to start`, e)
    unload(a.id)
    return String(e?.message ?? e)
  }
}

async function sync(list: Awaited<ReturnType<typeof window.atlas.addons.list>>) {
  const out: State['list'] = []
  for (const a of list) {
    let error: string | undefined
    if (a.enabled) error = await load(a)
    else unload(a.id)
    out.push({ id: a.id, name: a.name, version: a.version, description: a.description, enabled: a.enabled, error })
  }
  set({ list: out })
}

export const loadAddons = async () => sync(await window.atlas.addons.list())
export const setAddonEnabled = async (id: string, on: boolean) => sync(await window.atlas.addons.setEnabled(id, on))

const matches = (e: KeyboardEvent, shortcut: string) => {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts.pop()
  return e.key.toLowerCase() === key && (e.metaKey || e.ctrlKey) === parts.includes('mod') && e.shiftKey === parts.includes('shift') && e.altKey === parts.includes('alt')
}
window.addEventListener('keydown', (e) => {
  const c = state.commands.find((c) => c.shortcut && matches(e, c.shortcut))
  if (!c) return
  e.preventDefault()
  c.run()
})
