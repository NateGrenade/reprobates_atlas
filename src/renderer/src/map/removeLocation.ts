// Remove a place from the map, with a confirmation that says exactly what happens, and Undo.
import type { Location } from '@core/vault'
import { patchFrontmatter, patchFrontmatterMany, readFrontmatter, splitNote } from '@core/note'
import { useStore } from '../store'
import { restoreKeys } from '../timeline/eventOps'

const MAP_KEYS = ['type', 'parent', 'map_kind', 'map_pos', 'map_size', 'map_inclination', 'map_scene']

export async function removeLocation(loc: Location) {
  const st = useStore.getState()
  const ix = st.index!
  const text = st.files.get(loc.id)
  if (typeof text !== 'string') return
  const fm = readFrontmatter(text)
  const body = splitNote(text).body.trim()
  const extraKeys = Object.keys(fm.data).filter((k) => !MAP_KEYS.includes(k) && k !== 'source' && k !== 'title')
  // a note with nothing but map placement is deleted; one with lore keeps its text and only stops being a place
  const stub = !body && !extraKeys.length
  const kids = ix.children(loc.id).map((c) => ix.entities.get(c) as Location)
  const parent = loc.parent ? (ix.entities.get(loc.parent) as Location | undefined) : undefined
  const events = ix.beats.filter((b) => b.location === loc.id).length
  const lines = [
    `Remove “${loc.name}” from the map?`,
    '',
    stub ? `Its note ${loc.id} only holds map placement, so it is moved to the trash.` : `Its note ${loc.id} is kept with all its text. Only its map placement is removed.`
  ]
  if (kids.length) lines.push(`${kids.length} place${kids.length > 1 ? 's' : ''} inside it (${kids.slice(0, 4).map((k) => k.name).join(', ')}${kids.length > 4 ? '…' : ''}) move${kids.length > 1 ? '' : 's'} up to ${parent ? parent.name : 'the top level'}.`)
  if (events) lines.push(`${events} event${events > 1 ? 's' : ''} that happen${events > 1 ? '' : 's'} here keep${events > 1 ? '' : 's'} the name but will no longer show on the map.`)
  if (loc.scene) lines.push(`Its scene file ${loc.scene} is left in place.`)
  lines.push('', 'You can undo this with Undo or Cmd+Z.')
  if (!window.confirm(lines.join('\n'))) return

  const before: [string, string, string | null, string[]][] = []
  for (const k of kids) {
    const t = st.files.get(k.id)
    if (typeof t !== 'string') continue
    const moved = patchFrontmatter(t, 'parent', parent ? `[[${parent.name}]]` : undefined)
    before.push([k.id, t, moved, ['parent']])
    await st.writeFile(k.id, moved)
  }
  if (st.mapFocus && ix.subtree(loc.id).has(st.mapFocus)) st.setMapFocus(loc.parent ?? null)
  const stripped = stub ? null : patchFrontmatterMany(text, Object.fromEntries(MAP_KEYS.map((k) => [k, undefined])))
  before.unshift([loc.id, text, stripped, MAP_KEYS])
  if (st.selected === loc.id) st.select(null)
  if (stub) {
    await window.atlas.trash(loc.id)
    useStore.getState().applyChanges([[loc.id, false]])
  } else await st.writeFile(loc.id, stripped!)

  useStore.getState().showToast(
    `Removed ${loc.name}${stub ? ' (moved to the trash)' : ' from the map (note kept)'}`,
    async () => {
      for (const [p, t, after, keys] of before) await restoreKeys(p, t, after, keys)
      useStore.getState().select(loc.id)
    },
    true
  )
}
