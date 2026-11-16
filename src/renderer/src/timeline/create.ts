// One way to create a timeline event, used by the toolbar, lane "+", double-click, the palette and the Inspector.
import { beatPath, newBeatText } from '@core/beats'
import type { BeatDate as StoryDate } from '@core/beats'
import { useStore } from '../store'

export interface EventDefaults {
  characters?: string[]
  location?: string
  timelines?: string[]
  /** quoted-wikilink value for `main_event` (a new sub-event) */
  mainEvent?: string
}

/** Creates "New event" at `date` (default: the time cursor), selects it and opens the timeline on it. */
export async function createEvent(defaults: EventDefaults = {}, date?: StoryDate, opts: { show?: boolean } = { show: true }) {
  const st = useStore.getState()
  const ix = st.index
  if (!ix) return null
  const dpy = ix.config.days_per_year
  const d: StoryDate = date ?? (() => {
    const k = Math.round(st.timeCursor)
    const year = Math.floor(k / dpy)
    return { year, day: k - year * dpy + 1 }
  })()
  const title = 'New event'
  const path = beatPath(title, (p) => useStore.getState().files.has(p))
  await st.writeFile(path, newBeatText({ title, date: d, ...defaults }))
  useStore.getState().select(path)
  if (opts.show) useStore.getState().showOnTimeline(Math.round((d.year * dpy) + (d.day ?? 1) - 1))
  // put the caret in the title so typing names it
  setTimeout(() => (document.querySelector('.beat-title-input') as HTMLInputElement | null)?.select(), 300)
  return path
}

/** Wikilink for an entity id, as written into a new event. */
export function linkFor(id: string) {
  const ix = useStore.getState().index
  return `[[${ix?.entities.get(id)?.name ?? id.split('/').pop()!.replace(/\.md$/, '')}]]`
}
