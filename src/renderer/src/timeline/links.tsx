// Linked events (contract 4): pick a main event, unlink, follow toggle, sub-event list, event context menu.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { beatLink, formatOffset } from '@core/beats'
import { patchFrontmatterMany } from '@core/note'
import { formatWhen } from '@core/config'
import { fuzzyScore } from '@core/fuzzy'
import type { Beat, VaultIndex } from '@core/vault'
import { useStore } from '../store'
import { deleteEvent, duplicateEvent, editWithUndo } from './eventOps'
import { createEvent } from './create'

/** Events `id` may name as its main event: not itself, and nothing that already hangs below it (no cycles). */
export function mainCandidates(ix: VaultIndex, id: string): Beat[] {
  const below = (b: Beat) => {
    const seen = new Set<string>()
    for (let cur: string | undefined = b.id; cur && !seen.has(cur); cur = ix.beat(cur)?.main) {
      if (cur === id) return true
      seen.add(cur)
    }
    return false
  }
  return ix.beats.filter((b) => !below(b))
}

/** Link `path` to a main event (or unlink with null). One Undo restores the file. */
export function setMainEvent(path: string, main: string | null) {
  const st = useStore.getState()
  const text = st.files.get(path)
  const ix = st.index
  if (typeof text !== 'string' || !ix) return
  const title = ix.beat(path)?.title ?? path
  if (main) {
    const mt = ix.beat(main)?.title ?? main
    return editWithUndo(path, patchFrontmatterMany(text, { main_event: beatLink(main) }), `Linked “${title}” to “${mt}”`)
  }
  return editWithUndo(path, patchFrontmatterMany(text, { main_event: undefined, follows_main: undefined }), `Unlinked “${title}”`)
}

export function setFollows(path: string, on: boolean) {
  const st = useStore.getState()
  const text = st.files.get(path)
  if (typeof text !== 'string') return
  const next = patchFrontmatterMany(text, { follows_main: on ? true : undefined })
  if (next !== text) return st.writeFile(path, next)
}

/** Search events by title; Enter or click picks. */
export function EventPicker({ ix, exclude, onPick, autoFocus = true, placeholder = 'Search events…' }: { ix: VaultIndex; exclude: string; onPick(id: string): void; autoFocus?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const list = useMemo(() => {
    const all = mainCandidates(ix, exclude)
    if (!q.trim()) return all.slice(0, 40)
    return all
      .map((b) => ({ b, s: fuzzyScore(q, b.title) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .map((x) => x.b)
      .slice(0, 40)
  }, [ix, exclude, q])
  return (
    <div className="event-picker">
      <input
        className="field-input"
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => (setQ(e.target.value), setHi(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, list.length - 1)))
          if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)))
          if (e.key === 'Enter' && list[hi]) onPick(list[hi].id)
        }}
      />
      <div className="event-picker-list">
        {list.map((b, i) => (
          <button key={b.id} className={`lane-opt event-opt${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => onPick(b.id)}>
            <span className="n">{b.title}</span>
            <span className="muted">{formatWhen(ix.config, b)}</span>
          </button>
        ))}
        {!list.length && <div className="muted event-empty">No other events match.</div>}
      </div>
    </div>
  )
}

/** Right-click menu on a timeline event. */
export function EventMenu({ path, at, onClose }: { path: string; at: { x: number; y: number }; onClose(): void }) {
  const ix = useStore((s) => s.index)!
  const [picking, setPicking] = useState(false)
  const beat = ix.beat(path)
  const hasLink = !!ix.notes.get(path)?.fm.data.main_event
  useEffect(() => {
    const h = (e: MouseEvent) => !(e.target as HTMLElement).closest?.('.event-menu') && onClose()
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [onClose])
  const items: [string, () => void, string?][] = [
    ['Edit', () => useStore.getState().select(path)],
    ['Duplicate', () => duplicateEvent(path)],
    [beat?.main ? 'Change main event…' : 'Link to main event…', () => setPicking(true), 'keep'],
    ...(hasLink ? [['Unlink from main event', () => setMainEvent(path, null)] as [string, () => void]] : []),
    ['Delete', () => deleteEvent(path)]
  ]
  const stop = { onMouseDown: (e: any) => e.stopPropagation(), onPointerDown: (e: any) => e.stopPropagation(), onPointerUp: (e: any) => e.stopPropagation(), onPointerMove: (e: any) => e.stopPropagation(), onDoubleClick: (e: any) => e.stopPropagation() }
  return createPortal(
    <div className={`ctx-menu event-menu${picking ? ' picking' : ''}`} style={{ position: 'fixed', left: at.x, top: at.y }} {...stop}>
      {picking ? (
        <>
          <div className="event-menu-head">Main event of “{beat?.title}”</div>
          <EventPicker ix={ix} exclude={path} onPick={(id) => (onClose(), setMainEvent(path, id))} />
        </>
      ) : (
        items.map(([l, fn, keep]) => (
          <button key={l} className={l === 'Delete' ? 'danger' : ''} onClick={() => (keep ? fn() : (onClose(), fn()))}>
            {l}
          </button>
        ))
      )}
    </div>,
    document.body
  )
}

/** Event editor: Main event picker and the follow toggle. */
export function MainEventField({ beat }: { beat: Beat }) {
  const ix = useStore((s) => s.index)!
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const raw = ix.notes.get(beat.id)?.fm.data.main_event
  const main = beat.main ? ix.beat(beat.main) : undefined
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  return (
    <>
      <div className="field main-event-field">
        <label>Main event</label>
        <div className="tokens pop-wrap" ref={wrap}>
          {raw !== undefined && (
            <span className={`token${main ? '' : ' broken'}`}>
              <button className="token-main" onClick={() => main && useStore.getState().select(main.id)} title={main ? 'Select the main event' : 'This link does not point at an event'}>
                {main?.title ?? String(raw)}
              </button>
              <button className="token-x" aria-label="Unlink from main event" title="Unlink" onClick={() => setMainEvent(beat.id, null)}>
                ×
              </button>
            </span>
          )}
          <button className="token-add main-pick" onClick={() => setOpen(!open)}>
            {raw !== undefined ? 'change' : '+ choose'}
          </button>
          {open && (
            <div className="pop main-pop">
              <EventPicker ix={ix} exclude={beat.id} onPick={(id) => (setOpen(false), setMainEvent(beat.id, id))} />
            </div>
          )}
        </div>
      </div>
      {raw !== undefined && (
        <div className="field follow-field">
          <label>Moves with the main event</label>
          <div className="tokens">
            <button className={`chip follow-toggle${beat.follows ? ' on' : ''}`} onClick={() => setFollows(beat.id, !beat.follows)} aria-pressed={beat.follows}>
              {beat.follows ? 'yes' : 'no'}
            </button>
            {main && <span className="muted follow-offset">{formatOffset(beat.key - main.key)} from “{main.title}”</span>}
          </div>
        </div>
      )}
    </>
  )
}

/** Event editor: the sub-events of this event, with offsets and follow toggles, and + Add sub-event. */
export function SubEventsField({ beat }: { beat: Beat }) {
  const ix = useStore((s) => s.index)!
  const subs = beat.subs.map((s) => ix.beat(s)!).filter(Boolean)
  const add = () => {
    const ev = { year: beat.year, day: beat.day, ...(beat.day !== undefined && beat.hour !== undefined ? { hour: beat.hour, minute: beat.minute } : {}) }
    return createEvent({ mainEvent: beatLink(beat.id) }, ev, { show: false })
  }
  return (
    <div className="field sub-events">
      <label>Sub-events</label>
      {subs.map((s) => (
        <div className="sub-row" key={s.id} data-sub={s.id}>
          <button className="sub-title" onClick={() => useStore.getState().select(s.id)} title="Select this sub-event">
            {s.title}
          </button>
          <span className="muted sub-offset">{formatOffset(s.key - beat.key)}</span>
          <button className={`chip sub-follow${s.follows ? ' on' : ''}`} onClick={() => setFollows(s.id, !s.follows)} title={s.follows ? 'Moves with this event. Click to keep it in place.' : 'Stays in place. Click to make it move with this event.'} aria-pressed={s.follows}>
            {s.follows ? 'moves with it' : 'stays'}
          </button>
        </div>
      ))}
      <button className="chip-btn add-sub" onClick={add}>
        + Add sub-event
      </button>
    </div>
  )
}
