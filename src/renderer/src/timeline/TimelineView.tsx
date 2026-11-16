import { animate, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react'
import { useStore, type TimelineGroup } from '../store'
import type { Beat, Location, VaultIndex } from '@core/vault'
import { followerIds, redate } from '@core/beats'
import { createEvent } from './create'
import { AddLaneRow, LanesMenu, NewThreadButton, ThreadLaneMenu } from './lanes'
import { deleteEvent, redateEvent, reassignText } from './eventOps'
import { EventMenu } from './links'
import { formatWhen } from '@core/config'
import { PATHS, parseView, type LanePref } from '@core/config'
import { saveLanePref } from './viewPrefs'
import { TEXT_SCALE } from '../store'
import { setConfigKeys } from '@core/configEdit'
import { keyToX, mm, mmInv, snap, ticks, xToKey, zoomAt, type Viewport } from './axis'

const LANE_LABEL_W = 176
const ROW_H = 30
const LANE_PAD = 12

interface Lane {
  id: string
  label: string
  sub?: string
  beats: Beat[]
  defaults: { characters?: string[]; location?: string; timelines?: string[] }
  color?: string
}

const linkFor = (ix: VaultIndex, id: string) => `[[${ix.entities.get(id)?.name ?? id.split('/').pop()!.replace(/\.md$/, '')}]]`

export type { LanePref }
type LaneGroup = 'timeline' | 'character' | 'location'

/** Every lane a grouping mode can show, in display order ("No ..." last). */
export function possibleLanes(ix: VaultIndex, group: LaneGroup): Lane[] {
  const none: Lane = { id: '__none', label: group === 'timeline' ? 'No thread' : group === 'character' ? 'No character' : 'No place', beats: [], defaults: {} }
  let lanes: Lane[]
  if (group === 'timeline') lanes = ix.config.timelines.map((t) => ({ id: t.slug, label: t.name, sub: 'thread', beats: [], defaults: { timelines: [t.slug] }, color: t.color }))
  else if (group === 'character')
    lanes = [...ix.entities.values()].filter((e) => e.type === 'character').sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ id: e.id, label: e.name, sub: 'character', beats: [], defaults: { characters: [linkFor(ix, e.id)] } }))
  else lanes = ix.locations().sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ id: l.id, label: l.name, sub: l.kind, beats: [], defaults: { location: linkFor(ix, l.id) } }))
  return [...lanes, none]
}

function buildLanes(ix: VaultIndex, beats: Beat[], group: TimelineGroup, pref?: LanePref): Lane[] {
  if (group === 'none') return [{ id: 'all', label: 'All events', beats, defaults: {} }]
  const all = possibleLanes(ix, group)
  const byId = new Map(all.map((l) => [l.id, l]))
  for (const b of beats) {
    const keys = group === 'timeline' ? b.timelines.filter((s) => byId.has(s)) : group === 'character' ? b.characters.filter((c) => byId.has(c)) : b.location && byId.has(b.location) ? [b.location] : []
    if (!keys.length) byId.get('__none')!.beats.push(b)
    for (const k of keys) byId.get(k)!.beats.push(b)
  }
  if (pref && !pref.auto) return all.filter((l) => pref.shown.includes(l.id))
  // threads are created on purpose, so every thread shows; characters and places show when they have events
  const used = all.filter((l) => l.id !== '__none' && (l.beats.length || group === 'timeline'))
  if (group !== 'timeline') used.sort((a, b) => b.beats.length - a.beats.length || a.label.localeCompare(b.label))
  const none = byId.get('__none')!
  return none.beats.length || !used.length ? [...used, none] : used
}

export function TimelineView() {
  const ix = useStore((s) => s.index)!
  const group = useStore((s) => s.timelineGroup)
  const filter = useStore((s) => s.timelineFilter)
  const selected = useStore((s) => s.selected)
  const cursor = useStore((s) => s.timeCursor)
  const focus = useStore((s) => s.timelineFocus)
  const st = useStore.getState
  const dpy = ix.config.days_per_year
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [vp, setVp] = useState<Viewport>(() => {
    const saved = sessionStorage.getItem('atlas.timeline.vp')
    return saved ? JSON.parse(saved) : { center: 0, ppd: 1, width: 1000 }
  })
  const v: Viewport = { ...vp, width }
  useEffect(() => sessionStorage.setItem('atlas.timeline.vp', JSON.stringify(vp)), [vp])

  useLayoutEffect(() => {
    const el = host.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - LANE_LABEL_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const beats = useMemo(() => {
    const sub = filter.location ? ix.subtree(filter.location) : null
    return ix.beats.filter(
      (b) =>
        (!filter.character || b.characters.includes(filter.character)) &&
        (!sub || (b.location && sub.has(b.location))) &&
        (!filter.timeline || b.timelines.includes(filter.timeline)) &&
        (!filter.status || b.status === filter.status)
    )
  }, [ix, filter])
  // lane choices live in the vault (Atlas/view.json), shared with everyone using it
  const viewText = useStore((s) => s.files.get(PATHS.view))
  const prefs = useMemo(() => parseView(typeof viewText === 'string' ? viewText : null).lanes ?? {}, [viewText])
  const pref = group === 'none' ? undefined : prefs[group]
  const lanes = useMemo(() => buildLanes(ix, beats, group, pref), [ix, beats, group, pref])
  const setPref = (p: LanePref) => {
    if (group === 'none') return
    void saveLanePref(group, p)
  }

  const fitAll = (bs = beats) => {
    if (!bs.length) return setVp({ center: 0, ppd: width / (dpy * 40), width })
    const lo = Math.min(...bs.map((b) => b.key)), hi = Math.max(...bs.map((b) => b.endKey ?? b.key))
    const span = Math.max(hi - lo, dpy)
    setVp({ center: (lo + hi) / 2, ppd: (width * 0.84) / span, width })
  }
  const jumpTo = (key: number, ppd?: number) => {
    const from = vp.center
    const fromPpd = vp.ppd
    const toPpd = ppd ?? vp.ppd
    animate(0, 1, {
      duration: st().reducedMotion ? 0 : 0.6,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: (t) => setVp((p) => ({ ...p, center: from + (key - from) * t, ppd: Math.exp(Math.log(fromPpd) + (Math.log(toPpd) - Math.log(fromPpd)) * t) }))
    })
  }
  // first visit: fit everything
  useEffect(() => {
    if (!sessionStorage.getItem('atlas.timeline.vp')) fitAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (focus) jumpTo(focus.key, Math.max(vp.ppd, width / (dpy * 1.5)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n])

  // Delete / Backspace removes the selected event (with Undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
      if (useStore.getState().settingsOpen || useStore.getState().calendarsOpen) return
      const sel = useStore.getState().selected
      if (sel && useStore.getState().index?.beats.some((b) => b.id === sel)) {
        e.preventDefault()
        deleteEvent(sel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // wheel: vertical zooms around the cursor, horizontal pans
  useEffect(() => {
    const el = host.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.tl-lanes-scroll') && e.shiftKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - LANE_LABEL_W
      setVp((p) => {
        let n = { ...p, width }
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) n.center += e.deltaX / n.ppd
        else n = zoomAt(n, x, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)))
        return n
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [width])

  // Background drag pans. No pointer capture: capturing would retarget the following dblclick to this
  // container and swallow double-click-to-create (the bug Nathan hit). Window listeners do the drag instead.
  const onBgDown = (e: RPE) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.beat, button, select, input')) return
    const x0 = e.clientX, c0 = vp.center
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      moved = true
      setVp((q) => ({ ...q, center: c0 - (ev.clientX - x0) / q.ppd }))
    }
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const defaultsFor = (lane?: Lane) => {
    const d = { ...(lane?.defaults ?? {}) }
    if (filter.character && !d.characters) d.characters = [linkFor(ix, filter.character)]
    if (filter.location && !d.location) d.location = linkFor(ix, filter.location)
    if (filter.timeline && !d.timelines) d.timelines = [filter.timeline]
    return d
  }
  const createAt = (x: number, lane: Lane) => createEvent(defaultsFor(lane), snap(xToKey(v, x), vp.ppd, useStore.getState().index!.config.resolved.active), { show: false })
  /** toolbar / lane "+": at the time cursor when it is on screen, else the middle of the view */
  const createHere = (lane?: Lane) => {
    const cx = keyToX(v, cursor)
    const x = cx >= 0 && cx <= width ? cx : width / 2
    return createEvent(defaultsFor(lane), snap(xToKey(v, x), vp.ppd, useStore.getState().index!.config.resolved.active), { show: false })
  }

  const { ticks: tk, unit } = ticks(v, ix.config)
  const cursorX = keyToX(v, cursor)
  const eras = ix.config.eras

  return (
    <div className="timeline" ref={host}>
      <div className="tl-toolbar">
        <div className="tl-title">Timeline</div>
        <div className="seg">
          {(['none', 'timeline', 'character', 'location'] as TimelineGroup[]).map((g) => (
            <button key={g} className={group === g ? 'on' : ''} onClick={() => st().setTimelineGroup(g)}>
              {g === 'none' ? 'Main' : g === 'timeline' ? 'Threads' : g === 'character' ? 'Characters' : 'Places'}
            </button>
          ))}
        </div>
        <Filters ix={ix} />
        {group !== 'none' && <LanesMenu ix={ix} group={group} visible={lanes.map((l) => l.id)} pref={pref} setPref={setPref} />}
        {group === 'timeline' && <NewThreadButton />}
        <CalendarSwitch ix={ix} />
        <div className="tl-spacer" />
        <button className="chip-btn primary new-event" onClick={() => createHere()} title="Add an event at the time cursor (or double-click a lane)">
          + New event
        </button>
        <span className="tl-unit">{unit}</span>
        <button className="chip-btn" onClick={() => fitAll()}>
          Fit all
        </button>
        <button className="chip-btn" onClick={() => jumpTo(0, Math.max(vp.ppd, width / (dpy * 30)))}>
          Jump to epoch
        </button>
      </div>

      <div className="tl-axis" style={{ marginLeft: LANE_LABEL_W }} onClick={(e) => st().setTimeCursor(Math.round(xToKey(v, e.clientX - e.currentTarget.getBoundingClientRect().left)))}>
        {eras.map((er) => {
          const x0 = Math.max(-10, keyToX(v, er.start_year * dpy)), x1 = Math.min(width + 10, keyToX(v, er.end_year * dpy))
          return x1 > x0 ? (
            <div key={er.name} className="tl-era" style={{ left: x0, width: x1 - x0, background: er.color ?? 'rgba(142,140,255,0.12)' }}>
              <span>{er.name}</span>
            </div>
          ) : null
        })}
        {tk.map((t) => (
          <div key={t.key} className={`tl-tick${t.major ? ' major' : ''}`} style={{ transform: `translateX(${keyToX(v, t.key)}px)` }}>
            <span>{t.key === 0 && !ix.config.calendars.length ? `0 · ${ix.config.epoch_label}` : t.label}</span>
          </div>
        ))}
        <div className="tl-cursor-head" style={{ transform: `translateX(${cursorX}px)` }} title="Time cursor" />
      </div>

      <div className="tl-lanes-scroll" onPointerDown={onBgDown}>
        <div className="tl-grid" style={{ left: LANE_LABEL_W }}>
          {tk.map((t) => (
            <div key={t.key} className={`tl-gridline${t.major ? ' major' : ''}`} style={{ transform: `translateX(${keyToX(v, t.key)}px)` }} />
          ))}
          <div className="tl-epoch" style={{ transform: `translateX(${keyToX(v, 0)}px)` }} />
          <div className="tl-cursor" style={{ transform: `translateX(${cursorX}px)` }} />
        </div>
        {lanes.map((lane) => (
          <LaneRow key={lane.id} lane={lane} v={v} dpy={dpy} selected={selected} onCreate={createAt} onAdd={() => createHere(lane)} group={group} onHide={group === 'none' ? undefined : () => setPref({ auto: false, shown: lanes.map((l) => l.id).filter((id) => id !== lane.id) })} />
        ))}
        <AddLaneRow ix={ix} group={group} visible={lanes.map((l) => l.id)} setPref={setPref} />
        {beats.length === 0 && (
          <div className="tl-empty">
            <em>No events here yet.</em> Press <b>+ New event</b>, the + on a lane, or double-click a lane at the date you want.
          </div>
        )}
      </div>

      <Minimap beats={ix.beats} v={v} dpy={dpy} onJump={(k) => jumpTo(k)} />
    </div>
  )
}

function CalendarSwitch({ ix }: { ix: VaultIndex }) {
  const cals = ix.config.resolved.all
  const setActive = (slug: string) => {
    const st = useStore.getState()
    const cur = (st.files.get(PATHS.config) as string | undefined) ?? ''
    st.writeFile(PATHS.config, setConfigKeys(cur, { active_calendar: slug }))
  }
  return (
    <div className="tl-filters">
      {cals.length > 1 && (
        <label className="tl-filter on">
          <select value={ix.config.resolved.active.slug} onChange={(e) => setActive(e.target.value)} title="Calendar used for the axis and dates">
            {cals.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="chip-btn cal-btn" onClick={() => useStore.getState().setCalendarsOpen(true)} title="Calendars: how dates are shown and typed">
        {cals.length === 1 ? ix.config.resolved.active.name : 'Calendars'}
      </button>
    </div>
  )
}

function Filters({ ix }: { ix: VaultIndex }) {
  const filter = useStore((s) => s.timelineFilter)
  const set = useStore((s) => s.setTimelineFilter)
  const chars = [...ix.entities.values()].filter((e) => e.type === 'character').sort((a, b) => a.name.localeCompare(b.name))
  const locs = ix.locations().sort((a, b) => a.name.localeCompare(b.name))
  const statuses = [...new Set(ix.beats.map((b) => b.status).filter(Boolean))] as string[]
  const sel = (key: keyof typeof filter, label: string, opts: [string, string][]) => (
    <label className={`tl-filter${filter[key] ? ' on' : ''}`}>
      <select value={filter[key] ?? ''} onChange={(e) => set({ ...filter, [key]: e.target.value || undefined })}>
        <option value="">{label}</option>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <div className="tl-filters">
      {sel('character', 'Any character', chars.map((c) => [c.id, c.name]))}
      {sel('location', 'Any place', locs.map((l) => [l.id, l.name]))}
      {ix.config.timelines.length > 0 && sel('timeline', 'Any thread', ix.config.timelines.map((t) => [t.slug, t.name]))}
      {statuses.length > 0 && sel('status', 'Any status', statuses.map((s) => [s, s]))}
    </div>
  )
}

function LaneRow({ lane, v, dpy, selected, onCreate, onAdd, onHide, group }: { onHide?: () => void; lane: Lane; v: Viewport; dpy: number; selected: string | null; onCreate(x: number, lane: Lane): void; onAdd(): void; group: TimelineGroup }) {
  // stack visible beats into rows (greedy)
  const scale = useStore((s) => TEXT_SCALE[s.prefs.textSize ?? 'default'] ?? 1)
  const placed = useMemo(() => {
    const rows: number[] = []
    const out: { b: Beat; x: number; x2: number; row: number }[] = []
    for (const b of lane.beats) {
      const x = keyToX(v, b.key)
      const xe = b.endKey !== undefined ? keyToX(v, b.endKey) : x
      if (xe < -400 || x > v.width + 50) continue
      const w = Math.max(xe - x, 0) + Math.min(260 * scale, (26 + b.title.length * 6.6) * scale)
      let row = rows.findIndex((r) => r < x - 6)
      if (row < 0) row = rows.push(0) - 1
      rows[row] = x + w
      out.push({ b, x, x2: xe, row })
    }
    return { out, rows: Math.max(1, rows.length) }
  }, [lane.beats, v.center, v.ppd, v.width, scale])

  return (
    <div className="tl-lane" data-lane={lane.id} data-label={lane.label} style={{ height: placed.rows * ROW_H + LANE_PAD * 2 }}>
      <div className="tl-lane-label">
        <span className="n">
          {lane.color && <span className="lane-swatch" style={{ background: lane.color }} />}
          {lane.label}
        </span>
        {lane.sub === 'thread' && <ThreadLaneMenu slug={lane.id} />}
        {lane.sub && <span className="s">{lane.sub}</span>}
        <span className="c">{lane.beats.length}</span>
        {onHide && (
          <button className="lane-hide" onClick={onHide} title={`Hide the ${lane.label} lane (its events are not deleted). Bring it back with + Add lane.`} aria-label={`Hide lane ${lane.label}`}>
            ×
          </button>
        )}
        <button className="lane-add" onClick={onAdd} title={`Add an event to ${lane.label}`}>
          +
        </button>
      </div>
      <div
        className="tl-track"
        title="Double-click to add an event here"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.beat')) return
          onCreate(e.clientX - e.currentTarget.getBoundingClientRect().left, lane)
        }}
      >
        {placed.out.map(({ b, x, x2, row }) => (
          <BeatChip key={b.id} b={b} x={x} x2={x2} y={LANE_PAD + row * ROW_H} v={v} dpy={dpy} selected={selected === b.id} lane={lane.id} group={group} />
        ))}
      </div>
    </div>
  )
}

// the dragged chip sits under the pointer, so look past it
const laneAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => !el.closest('.beat'))?.closest('.tl-lane') as HTMLElement | null) ?? null

function BeatChip({ b, x, x2, y, v, dpy, selected, lane, group }: { b: Beat; x: number; x2: number; y: number; v: Viewport; dpy: number; selected: boolean; lane: string; group: TimelineGroup }) {
  const st = useStore.getState
  const [drag, setDrag] = useState<{ dx: number; dy: number; edge: boolean } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number; edge: boolean } | null>(null)
  const settle = useRef(0)
  const hover = useRef<HTMLElement | null>(null)
  const setHover = (el: HTMLElement | null) => {
    if (hover.current === el) return
    hover.current?.classList.remove('drop-target')
    hover.current = el
    el?.classList.add('drop-target')
  }

  const onDown = (e: RPE, edge: boolean) => {
    if (e.button !== 0) return
    e.stopPropagation()
    start.current = { x: e.clientX, y: e.clientY, edge }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
  }
  const onMove = (e: RPE) => {
    if (!start.current) return
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    if (!drag && Math.abs(dx) < 3 && Math.abs(dy) < 6) return
    setDrag({ dx, dy: start.current.edge || group === 'none' ? 0 : dy, edge: start.current.edge })
    if (!start.current.edge) {
      const cur = st().tlDrag
      st().setTlDrag({ id: b.id, dx, followers: cur?.id === b.id ? cur.followers : followerIds(st().index!, b.id) })
    }
    if (!start.current.edge && group !== 'none' && Math.abs(dy) > 10) {
      const l = laneAt(e.clientX, e.clientY)
      setHover(l && l.dataset.lane !== lane ? l : null)
    } else setHover(null)
  }
  const onUp = async (e: RPE) => {
    const s0 = start.current
    start.current = null
    if (!s0) return
    const clearFollow = () => st().tlDrag?.id === b.id && st().setTlDrag(null)
    const dx = e.clientX - s0.x
    const target = hover.current?.dataset.lane
    setHover(null)
    if (!drag || (Math.abs(dx) < 3 && !target)) {
      setDrag(null)
      clearFollow()
      st().select(b.id)
      st().setTimeCursor(b.key)
      return
    }
    const text = st().files.get(b.id)
    setDrag(null)
    if (typeof text !== 'string') return clearFollow()
    if (target && target !== lane && group !== 'none') {
      // vertical drop on another lane: reassign (and re-date if it also moved sideways)
      let next = text
      if (Math.abs(dx) >= 3) {
        const s = snap(b.key + dx / v.ppd, v.ppd, useStore.getState().index!.config.resolved.active)
        next = redate(next, s.day === undefined && b.day !== undefined ? { ...s, day: b.day } : s)
      }
      const ix = st().index!
      next = reassignText(next, group, lane === '__none' ? null : lane, target === '__none' ? null : target, (id) => linkFor(ix, id))
      const label = hover.current?.dataset.label ?? document.querySelector(`.tl-lane[data-lane="${CSS.escape(target)}"]`)?.getAttribute('data-label') ?? target
      const done = redateEvent(b.id, next, `Moved “${b.title}” to ${label}`)
      clearFollow()
      await done
      return
    }
    if (s0.edge) {
      const k = (b.endKey ?? b.key) + dx / v.ppd
      const d = snap(Math.max(k, b.key), v.ppd, useStore.getState().index!.config.resolved.active)
      await st().writeFile(b.id, redate(text, d, 'end'))
    } else {
      const k = b.key + dx / v.ppd
      const s = snap(k, v.ppd, useStore.getState().index!.config.resolved.active)
      const keepDay = s.day === undefined && b.day !== undefined ? { ...s, day: b.day } : s
      // spring the chip from where it was dropped onto its snapped place
      settle.current = dx - (keyToX(v, keepDay.year * dpy + ((keepDay.day ?? 1) - 1)) - x)
      let next = redate(text, keepDay)
      if (b.endYear !== undefined && b.endKey !== undefined) {
        // move spans as a whole
        const delta = keepDay.year * dpy + ((keepDay.day ?? 1) - 1) - b.key
        const ek = b.endKey + delta
        const ey = Math.floor(ek / dpy)
        next = redate(next, b.endDay !== undefined ? { year: ey, day: ek - ey * dpy + 1 } : { year: Math.round(ek / dpy) }, 'end')
      }
      const done = redateEvent(b.id, next)
      clearFollow()
      await done
      if (ref.current && settle.current) animate(ref.current, { x: [settle.current, 0] }, { type: 'spring', stiffness: 420, damping: 32 })
    }
  }

  // linked events: follow a dragged main event live; highlight the selected event's family
  const follow = useStore((s) => (s.tlDrag && s.tlDrag.id !== b.id && s.tlDrag.followers.includes(b.id) ? s.tlDrag.dx : 0))
  const kin = useStore((s) => {
    const sel = s.selected
    if (!sel || sel === b.id) return ''
    if (b.main === sel) return b.follows ? ' kin follows' : ' kin'
    return s.index?.beat(sel)?.main === b.id ? ' kin main' : ''
  })
  const mainTitle = b.main ? st().index?.beat(b.main)?.title : undefined
  const span = x2 > x
  const shift = drag && !drag.edge ? drag.dx : follow
  const lift = drag && !drag.edge ? drag.dy : 0
  const width = span ? Math.max(4, x2 - x + (drag?.edge ? drag.dx : 0)) : 0
  return (
    <motion.div
      ref={ref}
      className={`beat${selected ? ' selected' : ''}${b.approx ? ' approx' : ''}${span ? ' span' : ''}${drag ? ' dragging' : ''}${follow ? ' following' : ''}${kin}${b.main ? ' sub' : ''}`}
      style={{ left: x + shift, top: y + lift }}
      onPointerDown={(e) => onDown(e, false)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      title={`${b.title}\n${formatWhen(useStore.getState().index!.config, b)}${mainTitle ? `\nSub-event of “${mainTitle}”${b.follows ? ' (moves with it)' : ''}` : ''}${b.subs.length ? `\nMain event of ${b.subs.length}` : ''}`}
      data-beat={b.id}
    >
      {span && <div className="beat-bar" style={{ width }} />}
      <span className="beat-dot" />
      <span className="beat-label">
        {b.main && (
          <span className={`beat-link${b.follows ? ' on' : ''}`} aria-label={`Sub-event of ${mainTitle ?? 'another event'}`}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2.5 1.5v4.2a2 2 0 0 0 2 2h5" /><path d="M7.6 5.6l2 2.1-2 2.1" /></svg>
          </span>
        )}
        {b.approx && <span className="beat-approx">~</span>}
        {b.title}
      </span>
      <span className="beat-edge" style={{ left: span ? width - 4 : 6 }} onPointerDown={(e) => onDown(e, true)} onPointerMove={onMove} onPointerUp={onUp} title="Drag to make or resize a span" />
    {menu && <EventMenu path={b.id} at={menu} onClose={() => setMenu(null)} />}
    </motion.div>
  )
}

function Minimap({ beats, v, dpy, onJump }: { beats: Beat[]; v: Viewport; dpy: number; onJump(k: number): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => ref.current && setW(ref.current.clientWidth))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])
  const k0 = xToKey(v, 0), k1 = xToKey(v, v.width)
  const ms = [...beats.map((b) => mm(b.key, dpy)), mm(k0, dpy), mm(k1, dpy), 0]
  const lo = Math.min(...ms) - 0.15, hi = Math.max(...ms) + 0.15
  const X = (m: number) => ((m - lo) / (hi - lo)) * w
  const marks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((e) => [e, -e]).filter((m, i, a) => a.indexOf(m) === i && m >= lo && m <= hi)
  return (
    <div className="tl-minimap" ref={ref} onClick={(e) => onJump(mmInv(lo + ((e.clientX - e.currentTarget.getBoundingClientRect().left) / w) * (hi - lo), dpy))}>
      {marks.map((m) => (
        <div key={m} className="mm-mark" style={{ left: X(m) }}>
          <span>{m === 0 ? 'epoch' : `${m < 0 ? '−' : '+'}10${m === 1 || m === -1 ? '' : supers(Math.abs(m))}y`}</span>
        </div>
      ))}
      {beats.map((b) => (
        <div key={b.id} className="mm-dot" style={{ left: X(mm(b.key, dpy)) }} />
      ))}
      <div className="mm-window" style={{ left: X(mm(k0, dpy)), width: Math.max(3, X(mm(k1, dpy)) - X(mm(k0, dpy))) }} />
    </div>
  )
}

const supers = (n: number) => String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('')

export { PATHS }
