import { create } from 'zustand'
import { VaultIndex } from '@core/vault'
import type { FileChange, OpenedVault } from '../../preload/index'

/** The four built-in views, or an add-on's view (`addon:<addon id>/<view id>`). */
export type View = 'map' | 'timeline' | 'characters' | 'files' | `addon:${string}`
export type TimelineGroup = 'none' | 'timeline' | 'character' | 'location'
export interface TimelineFilter {
  character?: string
  location?: string
  timeline?: string
  status?: string
}

interface State {
  vault: { root: string; name: string } | null
  files: Map<string, string | null>
  dirs: Set<string>
  index: VaultIndex | null
  loading: boolean
  view: View
  /** Selected entity id or note path, shown in the Inspector */
  selected: string | null
  inspectorOpen: boolean
  /** Map: currently entered location (null = top level "Known space", undefined = not chosen yet: the map opens on its root) */
  mapFocus: string | null | undefined
  /** Files: open note and optional heading to scroll to */
  openNote: string | null
  openHeading: string | null
  /** Files view tabs (open note paths, in order) */
  tabs: string[]
  closeTab(path: string): void
  remapTabs(from: string, to: string): void
  paletteOpen: boolean
  reducedMotion: boolean
  toast: { id: number; message: string; undo?: () => void | Promise<void> } | null
  /** `keep` (deletes): the undo also joins a stack of the last 5, reachable with Cmd/Ctrl+Z after the toast is gone */
  showToast(message: string, undo?: () => void | Promise<void>, keep?: boolean): void
  undoStack: { id: number; message: string; undo: () => void | Promise<void> }[]
  /** Run an undo by toast id (or the most recent kept one) and drop it from the stack */
  runUndo(id?: number): Promise<boolean>
  /** a change an agent wants to save, waiting for the user's Apply or Skip (Atlas Live) */
  liveAsk: { title: string; lines: string[]; answer(ok: boolean): void } | null
  setLiveAsk(a: State['liveAsk']): void
  settingsOpen: boolean
  setSettingsOpen(o: boolean): void
  calendarsOpen: boolean
  setCalendarsOpen(o: boolean): void
  /** App-level preferences (userData settings.json, not the vault) */
  prefs: AppPrefs
  setPrefs(patch: Partial<AppPrefs>): void
  /** Map edit mode: click the ground to add a place, drag markers to move */
  mapEdit: boolean
  /** kind picked from the map's Add menu, used by the next ground click */
  armedKind: string | null
  setArmedKind(k: string | null): void
  setMapEdit(on: boolean): void
  /** Unsaved scene edits per location id (live preview) */
  scenePreview: Record<string, any>
  setScenePreview(id: string, spec: any | null): void
  /** Characters: open detail page */
  characterOpen: string | null
  openCharacter(id: string | null): void
  /** bumps when a binary file (portrait) is replaced, for cache-busting */
  binaryVersion: Record<string, number>
  bumpBinary(path: string): void
  /** Shared time cursor (sort key, days from epoch); the map scrubber follows it in S6 */
  timeCursor: number
  timelineGroup: TimelineGroup
  timelineFilter: TimelineFilter
  /** A request for the timeline to centre on a sort key (consumed by the view) */
  timelineFocus: { key: number; n: number } | null
  /** Timeline: an event being dragged sideways and the sub-events that move with it (live preview) */
  tlDrag: { id: string; dx: number; followers: string[] } | null
  setTlDrag(d: { id: string; dx: number; followers: string[] } | null): void
  setTimeCursor(k: number): void
  setTimelineGroup(g: TimelineGroup): void
  setTimelineFilter(f: TimelineFilter): void
  showOnTimeline(key: number | null, filter?: TimelineFilter): void
  setView(v: View): void
  select(id: string | null): void
  setInspectorOpen(o: boolean): void
  setMapFocus(id: string | null): void
  openFile(path: string | null, heading?: string | null): void
  setPaletteOpen(o: boolean): void
  load(v: OpenedVault | null): void
  applyChanges(c: FileChange[]): void
  setDirs(d: string[]): void
  /** Write a text file the user changed; the local index updates immediately. */
  writeFile(path: string, text: string): Promise<void>
}

export type TextSize = 'small' | 'default' | 'large'
export interface AppPrefs {
  /** 'system' follows the OS setting */
  reduceMotion?: 'system' | 'on' | 'off'
  textSize?: TextSize
  /** view shown when the app opens */
  defaultView?: View
}
export const TEXT_SCALE: Record<TextSize, number> = { small: 0.9, default: 1, large: 1.15 }
const motionFor = (p: AppPrefs) => (p.reduceMotion === 'on' ? true : p.reduceMotion === 'off' ? false : window.matchMedia('(prefers-reduced-motion: reduce)').matches)
/** UI text size: every font-size in app.css is multiplied by --ui-scale */
export const applyTextSize = (p: AppPrefs) => document.documentElement.style.setProperty('--ui-scale', String(TEXT_SCALE[p.textSize ?? 'default'] ?? 1))

/** Load app prefs once at startup (before the vault opens, so the launch view applies). */
export async function loadPrefs() {
  const prefs = ((await window.atlas.prefs.get().catch(() => ({}))) ?? {}) as AppPrefs
  applyTextSize(prefs)
  useStore.setState({ prefs, reducedMotion: motionFor(prefs), ...(prefs.defaultView ? { view: prefs.defaultView } : {}) })
}

export const useStore = create<State>((set, get) => ({
  vault: null,
  files: new Map(),
  dirs: new Set(),
  index: null,
  loading: true,
  view: 'map',
  selected: null,
  inspectorOpen: true,
  mapFocus: undefined,
  openNote: null,
  openHeading: null,
  tabs: JSON.parse(sessionStorage.getItem('atlas.tabs') ?? '[]'),
  closeTab: (path) => {
    const tabs = get().tabs
    const i = tabs.indexOf(path)
    const next = tabs.filter((p) => p !== path)
    sessionStorage.setItem('atlas.tabs', JSON.stringify(next))
    set({ tabs: next, ...(get().openNote === path ? { openNote: next[Math.min(i, next.length - 1)] ?? null } : {}) })
  },
  remapTabs: (from, to) => {
    const next = get().tabs.map((p) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p))
    sessionStorage.setItem('atlas.tabs', JSON.stringify(next))
    set({ tabs: next })
  },
  paletteOpen: false,
  reducedMotion: motionFor({}),
  timeCursor: 0,
  characterOpen: null,
  mapEdit: false,
  armedKind: null,
  setArmedKind: (armedKind) => set({ armedKind }),
  toast: null,
  undoStack: [],
  showToast: (message, undo, keep) => {
    const id = Date.now() + Math.random()
    set({ toast: { id, message, undo }, ...(undo && keep ? { undoStack: [...get().undoStack, { id, message, undo }].slice(-5) } : {}) })
  },
  runUndo: async (id) => {
    const stack = get().undoStack
    const toast = get().toast
    const entry = id !== undefined ? stack.find((u) => u.id === id) : stack[stack.length - 1]
    const fn = entry?.undo ?? (id !== undefined && toast?.id === id ? toast.undo : undefined)
    if (!fn) return false
    set({ undoStack: stack.filter((u) => u !== entry), ...(toast && (toast.id === id || toast.id === entry?.id) ? { toast: null } : {}) })
    await fn()
    if (id === undefined && entry) set({ toast: { id: Date.now() + Math.random(), message: `Undone: ${entry.message}` } })
    return true
  },
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  calendarsOpen: false,
  setCalendarsOpen: (calendarsOpen) => set({ calendarsOpen }),
  prefs: {},
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch }
    set({ prefs, reducedMotion: motionFor(prefs) })
    applyTextSize(prefs)
    void window.atlas.prefs.set(patch)
  },
  setMapEdit: (mapEdit) => set({ mapEdit }),
  scenePreview: {},
  liveAsk: null,
  setLiveAsk: (liveAsk) => set({ liveAsk }),
  setScenePreview: (id, spec) => {
    const n = { ...get().scenePreview }
    if (spec) n[id] = spec
    else delete n[id]
    set({ scenePreview: n })
  },
  openCharacter: (characterOpen) => set({ characterOpen, view: 'characters', ...(characterOpen ? { selected: characterOpen } : {}) }),
  binaryVersion: {},
  bumpBinary: (p) => set({ binaryVersion: { ...get().binaryVersion, [p]: Date.now() } }),
  timelineGroup: (localStorage.getItem('atlas.timeline.group') as TimelineGroup) ?? 'character',
  timelineFilter: {},
  timelineFocus: null,
  tlDrag: null,
  setTlDrag: (tlDrag) => set({ tlDrag }),
  setTimeCursor: (timeCursor) => set({ timeCursor }),
  setTimelineGroup: (timelineGroup) => (localStorage.setItem('atlas.timeline.group', timelineGroup), set({ timelineGroup })),
  setTimelineFilter: (timelineFilter) => set({ timelineFilter }),
  showOnTimeline: (key, filter) =>
    set({
      view: 'timeline',
      ...(filter ? { timelineFilter: filter } : {}),
      ...(key !== null ? { timelineFocus: { key, n: (get().timelineFocus?.n ?? 0) + 1 }, timeCursor: key } : {})
    }),
  setView: (view) => set({ view }),
  select: (selected) => set({ selected, inspectorOpen: selected ? true : get().inspectorOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setMapFocus: (mapFocus) => set({ mapFocus }),
  openFile: (openNote, heading = null) => {
    let tabs = get().tabs
    if (openNote && !tabs.includes(openNote)) {
      // replace the current tab's neighbour slot: new tabs open right after the active one
      const i = get().openNote ? tabs.indexOf(get().openNote!) : -1
      tabs = [...tabs.slice(0, i + 1), openNote, ...tabs.slice(i + 1)].slice(-12)
      sessionStorage.setItem('atlas.tabs', JSON.stringify(tabs))
    }
    set({ openNote, openHeading: heading, tabs, view: openNote ? 'files' : get().view })
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  load: (v) => {
    set({ undoStack: [] })
    if (!v) return set({ loading: false, vault: null, index: null, files: new Map(), dirs: new Set() })
    const files = new Map(v.files)
    set({ vault: { root: v.root, name: v.name }, files, dirs: new Set(v.dirs), index: new VaultIndex(files), loading: false, selected: null, mapFocus: undefined, openNote: null })
  },
  applyChanges: (changes) => {
    const files = new Map(get().files)
    let changed = false
    for (const [p, t] of changes) {
      if (t === false) {
        // a deleted folder arrives as its path: drop everything under it
        if (files.delete(p)) changed = true
        for (const k of [...files.keys()]) if (k.startsWith(p + '/')) (files.delete(k), (changed = true))
      } else if (files.get(p) !== t || !files.has(p)) {
        files.set(p, t)
        changed = true
      }
    }
    if (!changed) return
    const patch: Partial<State> = { files, index: new VaultIndex(files) }
    const open = get().openNote
    const tabs = get().tabs.filter((p) => files.has(p))
    if (tabs.length !== get().tabs.length) patch.tabs = tabs
    if (open && !files.has(open)) patch.openNote = tabs[0] ?? null
    const sel = get().selected
    if (sel && !files.has(sel)) patch.selected = null
    set(patch)
  },
  setDirs: (d) => set({ dirs: new Set(d) }),
  writeFile: async (path, text) => {
    get().applyChanges([[path, text]])
    await window.atlas.write(path, text)
  }
}))

export const vaultUrl = (p: string) => 'atlas://vault/' + p.split('/').map(encodeURIComponent).join('/')
export const noteName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')
