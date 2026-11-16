// Timeline lane choices, stored in the vault at Atlas/view.json (contract 6b), not in the app.
import { PATHS, parseView, type LanePref, type ViewFile } from '@core/config'
import { useStore } from '../store'

type LaneGroup = 'timeline' | 'character' | 'location'

const current = (): ViewFile => {
  const t = useStore.getState().files.get(PATHS.view)
  return parseView(typeof t === 'string' ? t : null)
}

async function writeView(v: ViewFile) {
  await useStore.getState().writeFile(PATHS.view, JSON.stringify(v, null, 2) + '\n')
}

/** Save one grouping's lane choice; `null` goes back to automatic lanes (the entry is removed). */
export async function saveLanePref(group: LaneGroup, p: LanePref | null) {
  const v = current()
  const lanes = { ...(v.lanes ?? {}) }
  if (p) lanes[group] = p
  else delete lanes[group]
  const next: ViewFile = { ...v, lanes }
  if (!Object.keys(lanes).length) delete next.lanes
  await writeView(next)
}

/**
 * One-time move of lane choices that older versions kept in this computer's localStorage
 * (`atlas.lanes.<vault root>`) into the vault. A vault that already has lane choices keeps them.
 */
export async function migrateLanePrefs() {
  const st = useStore.getState()
  const root = st.vault?.root
  if (!root) return
  const key = `atlas.lanes.${root}`
  const raw = localStorage.getItem(key)
  if (raw === null) return
  let old: Record<string, LanePref> = {}
  try {
    old = JSON.parse(raw) ?? {}
  } catch {
    /* unreadable: drop it */
  }
  const valid = Object.fromEntries(Object.entries(old).filter(([g, p]) => ['timeline', 'character', 'location'].includes(g) && p && typeof p.auto === 'boolean' && Array.isArray(p.shown)))
  const v = current()
  if (Object.keys(valid).length && !v.lanes) await writeView({ ...v, lanes: valid })
  localStorage.removeItem(key)
}
