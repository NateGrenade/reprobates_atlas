// Lanes menu (which lanes show), thread creation and the thread lane header menu.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { VaultIndex } from '@core/vault'
import type { TimelineDef } from '@core/config'
import { PATHS } from '@core/config'
import { setConfigKeys } from '@core/configEdit'
import { useStore } from '../store'
import { possibleLanes, type LanePref } from './TimelineView'

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  return { open, setOpen, ref }
}

export function LanesMenu({ ix, group, visible, pref, setPref }: { ix: VaultIndex; group: 'timeline' | 'character' | 'location'; visible: string[]; pref?: LanePref; setPref(p: LanePref): void }) {
  const { open, setOpen, ref } = usePopover()
  const [q, setQ] = useState('')
  const all = possibleLanes(ix, group)
  const auto = !pref || pref.auto
  const toggle = (id: string) => {
    const shown = new Set(auto ? visible : pref!.shown)
    shown.has(id) ? shown.delete(id) : shown.add(id)
    setPref({ auto: false, shown: [...shown] })
  }
  const list = all.filter((l) => !q || l.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="pop-wrap" ref={ref}>
      <button className={`chip-btn lanes-btn${open ? ' primary' : ''}`} onClick={() => setOpen(!open)}>
        Lanes · {visible.length}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="pop lanes-pop" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
            <input className="field-input" autoFocus placeholder={`Find a ${group === 'timeline' ? 'thread' : group === 'character' ? 'character' : 'place'}…`} value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="lane-opt auto">
              <input type="checkbox" checked={auto} onChange={(e) => setPref(e.target.checked ? { auto: true, shown: [] } : { auto: false, shown: visible })} />
              Show only lanes with events
            </label>
            <div className="lane-list">
              {list.map((l) => (
                <label key={l.id} className="lane-opt">
                  <input type="checkbox" checked={visible.includes(l.id)} onChange={() => toggle(l.id)} />
                  <span className={l.id === '__none' ? 'muted' : ''}>{l.label}</span>
                  {l.sub && l.id !== '__none' && <span className="muted lane-sub">{l.sub}</span>}
                </label>
              ))}
              {!list.length && <div className="muted" style={{ padding: 8 }}>Nothing matches.</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Fixed position for a popover next to its button, so a scrolling area can't clip it (opens upward near the bottom). */
const popAt = (el: HTMLElement | null): React.CSSProperties => {
  const r = el?.getBoundingClientRect()
  if (!r) return {}
  return r.bottom + 330 > window.innerHeight ? { position: 'fixed', left: r.left, top: 'auto', bottom: window.innerHeight - r.top + 6 } : { position: 'fixed', left: r.left, top: r.bottom + 6 }
}

/** Row under the last lane: the obvious place to add a lane (a hidden character, thread or place), or to turn lanes on. */
export function AddLaneRow({ ix, group, visible, setPref }: { ix: VaultIndex; group: 'none' | 'timeline' | 'character' | 'location'; visible: string[]; setPref(p: LanePref): void }) {
  const { open, setOpen, ref } = usePopover()
  const [q, setQ] = useState('')
  const [thread, setThread] = useState(false)
  if (group === 'none')
    return (
      <div className="tl-addlane">
        <span className="muted">Split this into lanes:</span>
        {([['character', 'by character'], ['timeline', 'by thread'], ['location', 'by place']] as const).map(([g, label]) => (
          <button key={g} className="chip-btn" onClick={() => useStore.getState().setTimelineGroup(g)}>
            {label}
          </button>
        ))}
      </div>
    )
  const noun = group === 'timeline' ? 'thread' : group === 'character' ? 'character' : 'place'
  const hidden = possibleLanes(ix, group).filter((l) => !visible.includes(l.id) && (!q || l.label.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="tl-addlane">
      <div className="pop-wrap" ref={ref}>
        <button className={`chip-btn add-lane-btn${open ? ' primary' : ''}`} onClick={() => setOpen(!open)}>
          + Add lane
        </button>
        <AnimatePresence>
          {open && (
            <motion.div className="pop lanes-pop" style={popAt(ref.current)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
              <input className="field-input" autoFocus placeholder={`Find a ${noun} to add as a lane…`} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="lane-list">
                {hidden.map((l) => (
                  <button key={l.id} className="lane-opt add-lane-opt" onClick={() => (setPref({ auto: false, shown: [...visible, l.id] }), setOpen(false), setQ(''))}>
                    <span className={l.id === '__none' ? 'muted' : ''}>{l.label}</span>
                    {l.sub && l.id !== '__none' && <span className="muted lane-sub">{l.sub}</span>}
                  </button>
                ))}
                {!hidden.length && <div className="muted" style={{ padding: 8 }}>{q ? 'Nothing matches.' : `Every ${noun} already has a lane.`}</div>}
              </div>
              {group === 'timeline' && (
                <button className="lane-opt add-lane-opt" onClick={() => (setOpen(false), setThread(true))}>
                  + New thread…
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span className="muted">Hover a lane and press × to hide it.</span>
      <AnimatePresence>{thread && <ThreadDialog onClose={() => setThread(false)} />}</AnimatePresence>
    </div>
  )
}

const THREAD_COLORS = ['#f0c27e', '#8e8cff', '#7fd6a8', '#ff9aa5', '#7cc4ff', '#d9a6ff', '#e8e2d0']
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'thread'

async function writeThreads(next: TimelineDef[]) {
  const st = useStore.getState()
  const cur = (st.files.get(PATHS.config) as string | undefined) ?? ''
  await st.writeFile(PATHS.config, setConfigKeys(cur, { timelines: next.map((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== ''))) }))
}

export function ThreadDialog({ initial, onClose }: { initial?: TimelineDef; onClose(): void }) {
  const ix = useStore((s) => s.index)!
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? THREAD_COLORS[ix.config.timelines.length % THREAD_COLORS.length])
  const [desc, setDesc] = useState(initial?.description ?? '')
  const save = async () => {
    if (!name.trim()) return
    const threads = ix.config.timelines
    if (initial) await writeThreads(threads.map((t) => (t.slug === initial.slug ? { ...t, name: name.trim(), color, description: desc.trim() || undefined } : t)))
    else {
      let slug = slugify(name)
      while (threads.some((t) => t.slug === slug)) slug += '-2'
      await writeThreads([...threads, { slug, name: name.trim(), color, description: desc.trim() || undefined }])
    }
    onClose()
  }
  return (
    <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.form className="thread-dialog" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="pd-title">{initial ? 'Edit thread' : 'New thread'}</div>
        <p className="muted" style={{ fontSize: 'calc(12px * var(--ui-scale))', margin: 0 }}>A thread is a custom sub-timeline (a plot line, a book, a war). Events join it from the event editor or by dragging them onto its lane.</p>
        <input className="field-input" autoFocus placeholder="Name, e.g. The expedition" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="swatches">
          {THREAD_COLORS.map((c) => (
            <button type="button" key={c} className={`swatch${c === color ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
          <input type="color" className="color-in" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <input className="field-input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="pd-foot">
          <span />
          <span>
            <button type="button" className="chip-btn" onClick={onClose}>
              Cancel
            </button>{' '}
            <button type="submit" className="chip-btn primary" disabled={!name.trim()}>
              {initial ? 'Save' : 'Create thread'}
            </button>
          </span>
        </div>
      </motion.form>
    </motion.div>
  )
}

export function NewThreadButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="chip-btn new-thread" onClick={() => setOpen(true)}>
        + New thread
      </button>
      <AnimatePresence>{open && <ThreadDialog onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  )
}

/** Thread lane header: rename / recolour / delete. */
export function ThreadLaneMenu({ slug }: { slug: string }) {
  const ix = useStore((s) => s.index)!
  const { open, setOpen, ref } = usePopover()
  const [edit, setEdit] = useState(false)
  const thread = ix.config.timelines.find((t) => t.slug === slug)
  if (!thread) return null
  const remove = async () => {
    const n = ix.beats.filter((b) => b.timelines.includes(slug)).length
    if (!window.confirm(`Delete the thread “${thread.name}”?${n ? `\n\n${n} event${n > 1 ? 's keep' : ' keeps'} its tag "${slug}" and will show under “No thread” (atlas validate will mention it).` : ''}`)) return
    const before = ix.config.timelines
    await writeThreads(before.filter((t) => t.slug !== slug))
    useStore.getState().showToast(
      `Deleted thread “${thread.name}”`,
      () => {
        // put this one thread back at its old place; threads made or edited since are left alone
        const now = useStore.getState().index!.config.timelines
        if (now.some((t) => t.slug === thread.slug)) return
        const next = [...now]
        next.splice(Math.min(before.indexOf(thread), next.length), 0, thread)
        return writeThreads(next)
      },
      true
    )
  }
  return (
    <div className="pop-wrap lane-menu" ref={ref}>
      <button className="lane-dots" onClick={() => setOpen(!open)} aria-label={`Thread options for ${thread.name}`}>
        ⋯
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="ctx-menu" style={{ position: 'absolute', left: 0, top: 22 }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <button onClick={() => (setOpen(false), setEdit(true))}>Rename or recolour</button>
            <button onClick={() => (setOpen(false), remove())}>Delete thread</button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{edit && <ThreadDialog initial={thread} onClose={() => setEdit(false)} />}</AnimatePresence>
    </div>
  )
}
