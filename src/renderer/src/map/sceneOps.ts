// Reading and saving a place's look (its scene spec). Shared by the Inspector's scene controls and Atlas Live.
import type { Location } from '@core/vault'
import { patchFrontmatter } from '@core/note'
import { validateSceneText, type SceneSpec } from '@core/scene'
import { PATHS } from '@core/config'
import { useStore } from '../store'
import { KIND_PRESET } from './Level'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene'
export const scenePath = (loc: Location) => loc.scene ?? `${PATHS.maps}/${slug(loc.name)}.scene.json`

export function savedScene(loc: Location): SceneSpec | null {
  const t = loc.scene ? useStore.getState().files.get(loc.scene) : null
  return typeof t === 'string' ? (validateSceneText(t).spec ?? null) : null
}
/** The look in force: an unsaved preview, else the saved scene, else the default for the place's kind. */
export function currentScene(loc: Location): SceneSpec {
  return (useStore.getState().scenePreview[loc.id] as SceneSpec | undefined) ?? savedScene(loc) ?? { version: 1, preset: (KIND_PRESET[loc.kind] as SceneSpec['preset']) ?? 'planet', params: {} }
}

/** Write the spec to the place's scene file (linking it from the note if new) and drop the preview. Returns an undo. */
export async function saveScene(loc: Location, spec: SceneSpec): Promise<() => Promise<void>> {
  const st = useStore.getState
  const path = scenePath(loc)
  const before = st().files.get(path)
  const noteBefore = st().files.get(loc.id)
  const clean: SceneSpec = { ...spec, params: Object.fromEntries(Object.entries(spec.params ?? {}).filter(([k, v]) => !k.startsWith('__') && v !== '' && v !== undefined)) }
  await st().writeFile(path, JSON.stringify(clean, null, 2) + '\n')
  if (!loc.scene && typeof noteBefore === 'string') await st().writeFile(loc.id, patchFrontmatter(noteBefore, 'map_scene', path))
  st().setScenePreview(loc.id, null)
  return async () => {
    if (typeof before === 'string') await st().writeFile(path, before)
    else {
      if (typeof noteBefore === 'string') await st().writeFile(loc.id, noteBefore)
      await window.atlas.trash(path)
      st().applyChanges([[path, false]])
    }
  }
}
