// Atlas Live, renderer side: what the running app can tell or do for an agent (plan/next.md, piece 3).
// The main process calls these through webContents.executeJavaScript; see src/main/live.ts.
import { readFrontmatter } from '@core/note'
import type { Location } from '@core/vault'
import type { SceneSpec } from '@core/scene'
import { DESIGN, checkDesign } from '@core/design'
import { useStore, type View } from './store'
import { currentScene, saveScene, savedScene, scenePath } from './map/sceneOps'

const place = (path: string): Location => {
  const e = useStore.getState().index?.entities.get(path)
  if (!e || e.type !== 'location') throw new Error(`Not a place on the map: ${path}. Use the vault path from get_state.`)
  return e as Location
}
const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v))

const front = (path: string | null | undefined) => {
  const text = path ? useStore.getState().files.get(path) : null
  return typeof text === 'string' ? readFrontmatter(text).data : null
}

/** Wait until the map has finished flying to the level it was sent to (so a capture shows the right thing). */
async function settle() {
  const arrived = () => useStore.getState().view !== 'map' || (window as any).__atlasMapShown === (useStore.getState().mapFocus ?? null)
  for (let i = 0; i < 80 && !arrived(); i++) await new Promise((r) => setTimeout(r, 100))
  await new Promise((r) => setTimeout(r, 600))
}

async function approve(title: string, lines: string[]): Promise<boolean> {
  const s = useStore.getState()
  if (s.liveAsk) throw new Error('Another change is already waiting for the user.')
  const ok = await new Promise<boolean>((done) => {
    const timer = setTimeout(() => done(false), 180000)
    s.setLiveAsk({ title, lines, answer: (v) => (clearTimeout(timer), done(v)) })
  })
  useStore.getState().setLiveAsk(null)
  return ok
}

export const live = {
  state() {
    const s = useStore.getState()
    return {
      vault: s.vault?.name ?? null,
      view: s.view,
      map_level: s.mapFocus ?? null,
      map_level_properties: front(s.mapFocus),
      selected: s.selected,
      selected_properties: front(s.selected),
      open_note: s.openNote,
      writer: (window as any).__atlasWriter ? (() => { try { const d = (window as any).__atlasWriter.read(); return { path: d.path, title: d.title, selection: d.selection, can_draft: d.canDraft } } catch { return null } })() : null,
      time_cursor: s.timeCursor,
      map_edit_mode: s.mapEdit,
      settings_open: s.settingsOpen
    }
  },
  async navigate(a: { view?: View; select?: string | null; map_level?: string | null; note?: string }) {
    const s = useStore.getState()
    const missing = [a.select, a.map_level, a.note].find((p) => p && !s.files.has(p))
    if (missing) throw new Error(`No such file in the vault: ${missing}`)
    if (a.view) s.setView(a.view)
    if (a.map_level !== undefined) s.setMapFocus(a.map_level)
    if (a.select !== undefined) s.select(a.select)
    if (a.note) s.openFile(a.note)
    await settle()
    return live.state()
  }
  ,
  listFiles() {
    return [...useStore.getState().files.keys()].sort()
  },
  readFile(path: string) {
    const content = useStore.getState().files.get(path)
    if (typeof content !== 'string') throw new Error(`No readable text file: ${path}`)
    return { path, content }
  },
  async proposeFile(a: { path: string; content?: string; before?: string; after?: string }) {
    const s = useStore.getState()
    if (!s.vault) throw new Error('Open a vault first.')
    if (!/^(?!\/)(?!.*(?:^|\/)\.\.?\/(?:|.*))[^\\]+\.(md|yaml|yml|json)$/i.test(a.path)) throw new Error('Use a vault-relative Markdown, YAML or JSON file path.')
    if (/^Manuscript\//i.test(a.path)) throw new Error('Use Writer tools for manuscript changes.')
    const original = s.files.get(a.path)
    const creating = a.content !== undefined
    if (creating && s.files.has(a.path)) throw new Error('File already exists; use a targeted edit.')
    if (!creating && typeof original !== 'string') throw new Error('No readable text file at that path.')
    if (!creating && (!a.before || a.after === undefined || (original as string).split(a.before).length !== 2)) throw new Error('The original text must occur exactly once; supply before and after.')
    const next = creating ? a.content! : (original as string).replace(a.before!, () => a.after!)
    const ok = await approve(`${creating ? 'Create' : 'Edit'} ${a.path}?`, creating ? ['New file:', next] : ['Replace:', a.before!, 'With:', a.after!])
    if (!ok) return { saved: false, note: 'The user skipped this change. Do not ask again unless requested.' }
    if (useStore.getState().vault?.root !== s.vault.root || useStore.getState().files.get(a.path) !== original) throw new Error('The vault or file changed while approval was pending. Review it again.')
    if (creating) {
      await window.atlas.create(a.path, next)
      useStore.getState().applyChanges([[a.path, next]])
    } else await useStore.getState().writeFile(a.path, next)
    return { saved: true, path: a.path }
  },
  writerRead() {
    const writer = (window as any).__atlasWriter
    if (!writer) throw new Error('Open the Writer add-on first.')
    return writer.read()
  },
  async writerChange(a: { action: 'comment' | 'suggest' | 'replace'; quote?: string; text?: string; replacement?: string; reason?: string; content?: string }) {
    const writer = (window as any).__atlasWriter
    if (!writer) throw new Error('Open the Writer add-on first.')
    const doc = writer.read()
    if (a.action === 'replace' && !doc.canDraft) throw new Error('Drafting must be enabled in Writer for this session.')
    const lines = a.action === 'comment' ? ['Passage:', a.quote ?? '', 'Comment:', a.text ?? ''] : a.action === 'suggest' ? ['Passage:', a.quote ?? '', 'Suggestion:', a.replacement ?? '', ...(a.reason ? ['Reason:', a.reason] : [])] : ['Proposed document:', a.content ?? '']
    if (!await approve(`${a.action === 'replace' ? 'Replace' : a.action === 'comment' ? 'Comment on' : 'Suggest an edit to'} ${doc.title}?`, lines)) return { saved: false }
    if (writer.read().path !== doc.path || writer.read().content !== doc.content) throw new Error('The open document changed while approval was pending. Review it again.')
    if (a.action === 'comment') return writer.comment({ quote: a.quote, text: a.text })
    if (a.action === 'suggest') return writer.suggest({ quote: a.quote, replacement: a.replacement, reason: a.reason })
    return writer.replace({ content: a.content })
  },
  describeScene(path: string) {
    const loc = place(path)
    const spec = currentScene(loc)
    return {
      place: loc.name,
      kind: loc.kind,
      preset: spec.preset,
      seed: spec.seed ?? null,
      current: Object.fromEntries(Object.entries(spec.params ?? {}).filter(([k]) => !k.startsWith('__'))),
      unsaved_preview: !!useStore.getState().scenePreview[loc.id],
      settings: (DESIGN[spec.preset] ?? []).map(({ key, label, kind, group, min, max, default: def, help }) => ({ key, label, type: kind, group, ...(kind === 'num' || kind === 'int' ? { min, max } : {}), default: def, help })),
      note: 'Settings not listed in "current" are at their default. To change the look: preview_scene, then apply_scene to save.'
    }
  },
  /** Show a changed look without saving. `params` are merged into the current ones; null removes a key. */
  async previewScene(a: { path: string; params?: Record<string, unknown>; seed?: number }) {
    const loc = place(a.path)
    const cur = currentScene(loc)
    const set = Object.fromEntries(Object.entries(a.params ?? {}).filter(([, v]) => v !== null))
    const problems = checkDesign(cur.preset, set)
    if (problems.length) throw new Error(problems.join(' '))
    const params = { ...(cur.params ?? {}), ...set }
    for (const [k, v] of Object.entries(a.params ?? {})) if (v === null) delete params[k]
    const s = useStore.getState()
    s.setScenePreview(loc.id, { ...cur, params, ...(a.seed !== undefined ? { seed: Math.trunc(a.seed) } : {}) } as SceneSpec)
    if (loc.parent !== undefined && s.mapFocus !== loc.id) {
      s.setView('map')
      s.setMapFocus(loc.id)
    }
    await settle()
    return { previewing: loc.name, note: 'Not saved. capture_view to look at it; apply_scene to save (the user is asked), revert_scene to drop it.' }
  },
  revertScene(path: string) {
    const loc = place(path)
    useStore.getState().setScenePreview(loc.id, null)
    return { reverted: loc.name }
  },
  /** Save the previewed look, if the user presses Apply on the card in the window. */
  async applyScene(path: string) {
    const loc = place(path)
    const s = useStore.getState()
    const next = s.scenePreview[loc.id] as SceneSpec | undefined
    if (!next) throw new Error('Nothing to apply: call preview_scene first.')
    if (s.liveAsk) throw new Error('Another change is already waiting for the user.')
    const before = savedScene(loc)
    const keys = new Set([...Object.keys(next.params ?? {}), ...Object.keys(before?.params ?? {})].filter((k) => !k.startsWith('__')))
    const lines = [...keys].filter((k) => JSON.stringify(next.params?.[k]) !== JSON.stringify(before?.params?.[k])).map((k) => `${DESIGN[next.preset]?.find((d) => d.key === k)?.label ?? k}: ${before?.params?.[k] === undefined ? 'default' : fmt(before.params[k])} → ${next.params?.[k] === undefined ? 'default' : fmt(next.params[k])}`)
    if (next.seed !== before?.seed) lines.push('New random layout')
    const ok = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 180000)
      s.setLiveAsk({ title: `Save this look for ${loc.name}?`, lines: lines.length ? lines : ['No visible differences'], answer: (v) => (clearTimeout(timer), done(v)) })
    })
    useStore.getState().setLiveAsk(null)
    if (!ok) return { saved: false, note: 'The user did not approve. The preview is still showing; revert_scene drops it. Do not ask again unless they tell you to.' }
    const undo = await saveScene(loc, next)
    useStore.getState().showToast(`Saved a new look for ${loc.name}`, undo)
    return { saved: true, file: scenePath(loc) }
  }
}
/** Entry point for the main process: errors come back as text (a thrown error would lose its message on the way). */
const call = async (name: keyof typeof live, arg?: unknown) => {
  try {
    return { value: await (live[name] as (a?: unknown) => unknown)(arg) }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  }
}
;(window as any).__atlasLive = { ...live, call }
