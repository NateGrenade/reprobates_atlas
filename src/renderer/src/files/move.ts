// Rename or move vault paths and update links to moved notes.
import { relinkFor } from '@core/relink'
import { useStore } from '../store'

export async function moveVaultPath(from: string, to: string, updateMoved?: (text: string) => string): Promise<boolean> {
  if (from === to) {
    if (updateMoved) {
      const text = useStore.getState().files.get(from)
      if (typeof text === 'string') await useStore.getState().writeFile(from, updateMoved(text))
    }
    return true
  }
  const files = useStore.getState().files
  const mapPath = (p: string) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  const work = new Map(files)
  const touched = new Map<string, number>()
  for (const p of [...files.keys()].filter((k) => (k === from || k.startsWith(from + '/')) && k.toLowerCase().endsWith('.md'))) {
    for (const e of relinkFor(work, p, mapPath(p))) {
      work.set(e.path, e.text)
      touched.set(e.path, (touched.get(e.path) ?? 0) + e.count)
    }
  }
  if (touched.size) {
    const list = [...touched].map(([p, n]) => `• ${p} (${n} link${n > 1 ? 's' : ''})`).join('\n')
    if (!window.confirm(`Rename and update links in ${touched.size} note${touched.size > 1 ? 's' : ''}?\n\n${list}`)) return false
  }
  if (updateMoved) {
    const text = work.get(from)
    if (typeof text === 'string') { work.set(from, updateMoved(text)); touched.set(from, touched.get(from) ?? 0) }
  }
  await window.atlas.rename(from, to)
  const st = useStore.getState()
  const moved: [string, string | null | false][] = []
  for (const [k, v] of st.files) if (k === from || k.startsWith(from + '/')) moved.push([k, false], [mapPath(k), v])
  st.setDirs([...st.dirs].map(mapPath))
  st.remapTabs(from, to)
  st.applyChanges(moved)
  if (st.openNote && mapPath(st.openNote) !== st.openNote) st.openFile(mapPath(st.openNote))
  if (st.selected && mapPath(st.selected) !== st.selected) st.select(mapPath(st.selected))
  if (st.mapFocus && mapPath(st.mapFocus) !== st.mapFocus) st.setMapFocus(mapPath(st.mapFocus))
  for (const [id, preview] of Object.entries(st.scenePreview)) if (mapPath(id) !== id) {
    st.setScenePreview(id, null)
    st.setScenePreview(mapPath(id), preview)
  }
  for (const p of touched.keys()) await useStore.getState().writeFile(mapPath(p), work.get(p) as string)
  return true
}
