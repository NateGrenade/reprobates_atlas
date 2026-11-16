// Event actions shared by the timeline, its context menu, keyboard and the event editor. Each offers Undo.
import { beatPath, cascadeRedate, unlinkSubs, type BeatWrite } from '@core/beats'
import { patchFrontmatter, patchFrontmatterMany, readFrontmatter } from '@core/note'
import { useStore } from '../store'

const name = (p: string) => p.split('/').pop()!.replace(/\.md$/, '')

/** Write several files with one index rebuild. */
async function writeAll(ws: { path: string; text: string }[]) {
  useStore.getState().applyChanges(ws.map((w) => [w.path, w.text]))
  await Promise.all(ws.map((w) => window.atlas.write(w.path, w.text)))
}

/** Put back each file's text from before a batch (never cascades again). */
async function restoreAll(ws: BeatWrite[]) {
  await writeAll(ws.map((w) => ({ path: w.path, text: w.before })))
}

/**
 * The one re-date path in the app: write the event's new text and move every sub-event that follows it
 * (contract 4, Linked events). When sub-events moved, or a message is given, one Undo restores every file.
 */
export async function redateEvent(path: string, next: string, message?: string) {
  const st = useStore.getState()
  if (!st.index) return
  const ws = cascadeRedate(st.index, path, next)
  if (!ws.length) return
  await writeAll(ws)
  const moved = ws.length - (ws[0]?.path === path ? 1 : 0)
  if (!moved && !message) return
  const title = (readFrontmatter(next).data.title as string) ?? name(path)
  const msg = (message ?? `Moved “${title}”`) + (moved ? ` and ${moved} linked event${moved > 1 ? 's' : ''}` : '')
  st.showToast(msg, () => restoreAll(ws))
}

/** Move an event file to the system trash; Undo writes it back. Sub-events of it stay and are unlinked. */
export async function deleteEvent(path: string) {
  const st = useStore.getState()
  const text = st.files.get(path)
  if (typeof text !== 'string') return
  const title = (readFrontmatter(text).data.title as string) ?? name(path)
  const unlink = st.index ? unlinkSubs(st.index, path) : []
  if (unlink.length && !window.confirm(`Delete “${title}”?\n\nIt is the main event of ${unlink.length} sub-event${unlink.length > 1 ? 's' : ''}. ${unlink.length > 1 ? 'They stay' : 'It stays'} on the timeline and will be unlinked from it (Undo links ${unlink.length > 1 ? 'them' : 'it'} again).`)) return
  if (unlink.length) await writeAll(unlink)
  await window.atlas.trash(path)
  st.applyChanges([[path, false]])
  if (st.selected === path) st.select(null)
  st.showToast(`Deleted “${title}” (moved to the trash)${unlink.length ? `, ${unlink.length} sub-event${unlink.length > 1 ? 's' : ''} unlinked` : ''}`, async () => {
    await window.atlas.create(path, text).catch(() => window.atlas.write(path, text))
    useStore.getState().applyChanges([[path, text]])
    for (const w of unlink) await restoreKeys(w.path, w.before, w.text, ['main_event', 'follows_main'])
    useStore.getState().select(path)
  }, true)
}

export async function duplicateEvent(path: string) {
  const st = useStore.getState()
  const text = st.files.get(path)
  if (typeof text !== 'string') return
  const title = ((readFrontmatter(text).data.title as string) ?? name(path)) + ' (copy)'
  const to = beatPath(title, (p) => useStore.getState().files.has(p))
  const next = patchFrontmatter(text, 'title', title)
  await window.atlas.create(to, next)
  st.applyChanges([[to, next]])
  st.select(to)
  st.showToast(`Duplicated as “${title}”`, () => deleteEventQuiet(to))
}

async function deleteEventQuiet(path: string) {
  await window.atlas.trash(path)
  useStore.getState().applyChanges([[path, false]])
}

/** Replace the file text and offer Undo back to the previous text. */
export async function editWithUndo(path: string, next: string, message: string) {
  const st = useStore.getState()
  const prev = st.files.get(path)
  if (typeof prev !== 'string' || prev === next) return
  await st.writeFile(path, next)
  st.showToast(message, () => useStore.getState().writeFile(path, prev))
}

/** Dragging an event to another lane: swap the lane's character / thread / place. `null` = the "No ..." lane. */
export function reassignText(text: string, group: 'character' | 'timeline' | 'location', from: string | null, to: string | null, linkOf: (id: string) => string): string {
  const d = readFrontmatter(text).data
  if (group === 'location') return patchFrontmatterMany(text, { location: to ? linkOf(to) : undefined, ...(to ? {} : { move: undefined }) })
  if (group === 'timeline') {
    const cur = (Array.isArray(d.timelines) ? d.timelines : []).filter((s: unknown) => s !== from)
    const next = to && !cur.includes(to) ? [...cur, to] : cur
    return patchFrontmatter(text, 'timelines', next.length ? next : undefined)
  }
  const ix = useStore.getState().index!
  const cur = (Array.isArray(d.characters) ? (d.characters as string[]) : []).filter((c) => !from || ix.resolveEntity(c) !== from)
  const next = to && !cur.some((c) => ix.resolveEntity(c) === to) ? [...cur, linkOf(to)] : cur
  return patchFrontmatter(text, 'characters', next.length ? next : undefined)
}

/**
 * Undo for a delete that removed frontmatter keys from a note. If the note is exactly as the delete left it, the
 * old text comes back byte for byte; if it was edited since, only the removed keys are put back and the edits stay.
 */
export async function restoreKeys(path: string, before: string, after: string | null, keys: string[]) {
  const st = useStore.getState()
  const cur = st.files.get(path)
  if (typeof cur !== 'string') {
    await window.atlas.create(path, before).catch(() => window.atlas.write(path, before))
    useStore.getState().applyChanges([[path, before]])
  } else if (cur === after) await st.writeFile(path, before)
  else {
    const d = readFrontmatter(before).data
    await st.writeFile(path, patchFrontmatterMany(cur, Object.fromEntries(keys.map((k) => [k, d[k]]))))
  }
}
