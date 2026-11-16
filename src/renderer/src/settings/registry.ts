// Settings sections registry. The Settings screen lists whatever is registered here, in `order`.
// Built-in sections register in ./sections.tsx; add-ons will register their own panes the same way.
import { useSyncExternalStore, type ReactNode } from 'react'

export interface SettingsSection {
  /** stable id, e.g. 'general' or 'addon.my-addon' */
  id: string
  title: string
  icon?: ReactNode
  /** sort position; built-ins use 10..90, add-ons default to 100 */
  order?: number
  render: () => ReactNode
}

/** An installed add-on, as listed in Settings > Add-ons. Nothing installs add-ons yet. */
export interface AddonInfo {
  id: string
  name: string
  version?: string
  description?: string
}

let sections: SettingsSection[] = []
let addons: AddonInfo[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

/** Add (or replace, by id) a Settings section. Returns a function that removes it. */
export function registerSettingsSection(s: SettingsSection): () => void {
  sections = [...sections.filter((x) => x.id !== s.id), s].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  emit()
  return () => {
    sections = sections.filter((x) => x !== s)
    emit()
  }
}

/** Record an installed add-on so Settings > Add-ons lists it. Returns a function that removes it. */
export function registerAddon(a: AddonInfo): () => void {
  addons = [...addons.filter((x) => x.id !== a.id), a]
  emit()
  return () => {
    addons = addons.filter((x) => x !== a)
    emit()
  }
}

export const useSettingsSections = () => useSyncExternalStore(subscribe, () => sections)
export const useAddons = () => useSyncExternalStore(subscribe, () => addons)
