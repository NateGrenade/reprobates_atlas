// Cmd+K command palette: notes, headings, entities, beats and full text, with canon-status filter chips.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyScore } from '@core/fuzzy'
import type { Location, VaultIndex } from '@core/vault'
import { formatWhen } from '@core/config'
import { useStore, noteName } from '../store'
import { createEvent } from '../timeline/create'
import { addonHost } from '../addons/host'

type Kind = 'command' | 'note' | 'heading' | 'entity' | 'beat' | 'text'
interface Item {
  kind: Kind
  key: string
  label: string
  detail: string
  path: string
  heading?: string
  snippet?: [string, string, string]
  score: number
}

const KIND_LABEL: Record<Kind, string> = { command: 'Actions', entity: 'Entities', note: 'Notes', heading: 'Headings', beat: 'Events', text: 'In text' }
const ORDER: Kind[] = ['command', 'entity', 'note', 'beat', 'heading', 'text']

function search(ix: VaultIndex, q: string, statuses: Set<string>): Item[] {
  const statusOk = (path: string) => {
    if (!statuses.size) return true
    const s = ix.notes.get(path)?.fm.data.status
    return typeof s === 'string' && statuses.has(s)
  }
  const out: Item[] = []
  const WORDS: Record<string, string> = { 'cmd:new-event': 'add moment beat timeline', 'cmd:add-character': 'new person card', 'cmd:calendars': 'calendar months weekdays dates', 'cmd:settings': 'preferences options text size vault' }
  for (const [label, detail, key] of [['New event', 'add an event to the timeline at the time cursor', 'cmd:new-event'], ['Add character', 'tag a note, a heading, or create one', 'cmd:add-character'], ['Calendars', 'edit how dates are shown and typed', 'cmd:calendars'], ['Settings', 'vault, appearance, timeline, add-ons', 'cmd:settings']]) {
    const s = q ? fuzzyScore(q, label + ' ' + WORDS[key]) : 0
    if (s !== null) out.push({ kind: 'command', key, label, detail, path: key, score: s + 100 })
  }
  for (const c of addonHost().commands) {
    const s = q ? fuzzyScore(q, c.title + ' ' + (c.detail ?? '')) : 0
    if (s !== null) out.push({ kind: 'command', key: 'addon:' + c.id, label: c.title, detail: c.detail ?? '', path: 'addon:' + c.id, score: s + 90 })
  }
  const push = (it: Omit<Item, 'score'>, text: string, bonus = 0) => {
    if (!statusOk(it.path)) return
    const s = fuzzyScore(q, text)
    if (s !== null) out.push({ ...it, score: s + bonus })
  }
  for (const e of ix.entities.values()) {
    const kind = e.type === 'location' ? (e as Location).kind : e.type
    const aliases = Array.isArray(e.data.aliases) ? (e.data.aliases as string[]) : []
    for (const name of [e.name, ...aliases]) push({ kind: 'entity', key: 'e:' + e.id + name, label: name, detail: name === e.name ? kind : `${kind} · ${e.name}`, path: e.id }, name, 60)
  }
  for (const n of ix.notes.values()) {
    if (ix.entities.has(n.path)) continue
    push({ kind: 'note', key: 'n:' + n.path, label: n.name, detail: n.path.split('/').slice(0, -1).join(' / '), path: n.path }, n.name, 30)
    const aliases = Array.isArray(n.fm.data.aliases) ? (n.fm.data.aliases as string[]) : []
    for (const a of aliases) if (typeof a === 'string') push({ kind: 'note', key: 'na:' + n.path + a, label: a, detail: `alias of ${n.name}`, path: n.path, heading: a }, a, 20)
  }
  for (const b of ix.beats) push({ kind: 'beat', key: 'b:' + b.id, label: b.title, detail: formatWhen(ix.config, b), path: b.id }, b.title, 10)
  if (q.trim().length >= 2) {
    for (const n of ix.notes.values()) for (const h of n.headings) push({ kind: 'heading', key: `h:${n.path}#${h.text}`, label: h.text, detail: n.name, path: n.path, heading: h.text }, h.text)
    const ql = q.trim().toLowerCase()
    if (ql.length >= 3) {
      let count = 0
      for (const n of ix.notes.values()) {
        if (!statusOk(n.path)) continue
        const body = n.body
        const at = body.toLowerCase().indexOf(ql)
        if (at < 0) continue
        const s = Math.max(0, at - 40)
        const pre = (s > 0 ? '…' : '') + body.slice(s, at).replace(/\s+/g, ' ')
        const post = body.slice(at + ql.length, at + ql.length + 60).replace(/\s+/g, ' ') + '…'
        const lineStart = body.lastIndexOf('\n', at) + 1
        const hd = [...n.headings].reverse().find((h) => h.offset <= lineStart)
        out.push({ kind: 'text', key: 't:' + n.path, label: n.name, detail: hd ? hd.text : '', path: n.path, heading: hd?.text, snippet: [pre, body.slice(at, at + ql.length), post], score: 0 })
        if (++count >= 25) break
      }
    }
  }
  out.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  return out.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
}

export function Palette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useStore.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])
  return <AnimatePresence>{open && <PaletteBody onClose={() => setOpen(false)} />}</AnimatePresence>
}

function PaletteBody({ onClose }: { onClose(): void }) {
  const ix = useStore((s) => s.index)
  const [q, setQ] = useState('')
  const [statuses, setStatuses] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const allStatuses = useMemo(() => {
    const s = new Set<string>()
    ix?.notes.forEach((n) => typeof n.fm.data.status === 'string' && s.add(n.fm.data.status))
    return [...s].sort()
  }, [ix])
  const results = useMemo(() => {
    if (!ix) return []
    const r = search(ix, q, statuses)
    // group by kind, cap each group
    const groups = ORDER.map((k) => r.filter((i) => i.kind === k).slice(0, q ? (k === 'text' ? 8 : 7) : 6))
    return groups.flat()
  }, [ix, q, statuses])
  useEffect(() => setCursor(0), [q, statuses])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (it: Item) => {
    const st = useStore.getState()
    onClose()
    if (it.kind === 'command') {
      if (it.key.startsWith('addon:')) addonHost().commands.find((c) => 'addon:' + c.id === it.key)?.run()
      else if (it.key === 'cmd:new-event') {
        st.setView('timeline')
        createEvent()
      } else if (it.key === 'cmd:calendars') st.setCalendarsOpen(true)
      else if (it.key === 'cmd:settings') st.setSettingsOpen(true)
      else st.setView('characters')
      return
    }
    if (it.kind === 'entity') {
      st.select(it.path)
      const e = st.index?.entities.get(it.path)
      if (e?.type === 'location') {
        st.setMapFocus((e as Location).parent ?? null)
        st.setView('map')
      } else st.openFile(e?.source?.path ?? it.path, e?.source?.heading ?? null)
    } else if (it.kind === 'beat') {
      st.select(it.path)
    } else {
      st.openFile(it.path, it.heading ?? null)
      st.select(it.path)
    }
  }

  return (
    <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onMouseDown={onClose}>
      <motion.div
        className="palette"
        initial={{ opacity: 0, y: -12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.99 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder="Search notes, places, people, moments…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') (e.preventDefault(), setCursor((c) => Math.min(results.length - 1, c + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)))
            else if (e.key === 'Enter' && results[cursor]) choose(results[cursor])
          }}
        />
        {allStatuses.length > 0 && (
          <div className="chips">
            {allStatuses.map((s) => (
              <button
                key={s}
                className={`chip${statuses.has(s) ? ' on' : ''} status-${s}`}
                onClick={() =>
                  setStatuses((cur) => {
                    const n = new Set(cur)
                    n.has(s) ? n.delete(s) : n.add(s)
                    return n
                  })
                }
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">{q ? 'Nothing matches.' : 'Start typing.'}</div>}
          {results.map((it, i) => (
            <div key={it.key}>
              {(i === 0 || results[i - 1].kind !== it.kind) && <div className="palette-group">{KIND_LABEL[it.kind]}</div>}
              <button data-i={i} className={`palette-item${i === cursor ? ' on' : ''}`} onMouseMove={() => setCursor(i)} onClick={() => choose(it)}>
                <span className="pi-label">{it.label}</span>
                {it.snippet ? (
                  <span className="pi-snippet">
                    {it.snippet[0]}
                    <mark>{it.snippet[1]}</mark>
                    {it.snippet[2]}
                  </span>
                ) : (
                  <span className="pi-detail">{it.detail}</span>
                )}
              </button>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}

export { noteName }
