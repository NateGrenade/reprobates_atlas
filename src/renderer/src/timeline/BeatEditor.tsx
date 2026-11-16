// Beat editor shown in the Inspector when a beat is selected. Every edit patches only the keys it touches.
import { useMemo, useState } from 'react'
import { patchFrontmatter, patchFrontmatterMany, splitNote, joinNote } from '@core/note'
import { formatDateInput } from '@core/dates'
import { formatWhen, parseWhen } from '@core/config'
import { fromCal, keyToStored, toCal } from '@core/calendar'
import { MOVES, type Beat, type Location } from '@core/vault'
import { beatLink, beatPath, redate } from '@core/beats'
import { useStore } from '../store'
import { deleteEvent, redateEvent } from './eventOps'
import { MainEventField, SubEventsField } from './links'
import { Editor } from '../files/Editor'

const linkName = (s: string) => /\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/.exec(s)?.slice(1).reverse().find(Boolean) ?? s

export function BeatEditor({ beat }: { beat: Beat }) {
  const ix = useStore((s) => s.index)!
  const text = useStore((s) => s.files.get(beat.id)) as string
  const writeFile = useStore((s) => s.writeFile)
  const data = ix.notes.get(beat.id)!.fm.data
  const write = (patch: Record<string, unknown>) => {
    const next = patchFrontmatterMany(text, patch)
    if (next !== text) writeFile(beat.id, next)
  }
  const [dateErr, setDateErr] = useState(false)
  // A new title also renames the file when the file name still follows the old title (filenames are cosmetic).
  const retitle = async (title: string) => {
    write({ title })
    const base = beat.id.split('/').pop()!.replace(/\.md$/, '').replace(/ \d+$/, '')
    if (base !== beat.title.replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim()) return
    const files = useStore.getState().files
    const to = beatPath(title, (p) => p !== beat.id && files.has(p))
    if (to === beat.id) return
    await window.atlas.rename(beat.id, to)
    const cur = useStore.getState().files.get(beat.id)
    useStore.getState().applyChanges([[beat.id, false], [to, cur ?? null]])
    // sub-events name this event by file name: point them at the new one
    for (const sub of beat.subs) {
      const t = useStore.getState().files.get(sub)
      if (typeof t === 'string') await writeFile(sub, patchFrontmatter(t, 'main_event', beatLink(to)))
    }
    useStore.getState().select(to)
  }
  const rawChars = (Array.isArray(data.characters) ? data.characters : []) as string[]
  const locs = useMemo(() => ix.locations().sort((a, b) => a.name.localeCompare(b.name)), [ix])
  const chars = useMemo(() => [...ix.entities.values()].filter((e) => e.type === 'character').sort((a, b) => a.name.localeCompare(b.name)), [ix])
  const st = useStore.getState
  const linkOf = (id: string) => `[[${ix.entities.get(id)!.name}]]`
  const [body, setBody] = useState(() => splitNote(text).body)

  return (
    <div className="beat-editor">
      <div className="insp-kicker">
        <span className="dot" />
        Event
        {beat.status && <span style={{ color: 'var(--text-4)' }}>· {beat.status}</span>}
      </div>
      <input
        className="beat-title-input"
        key={'t' + beat.title}
        defaultValue={beat.title}
        onBlur={(e) => {
          const title = e.currentTarget.value.trim()
          if (title && title !== beat.title) retitle(title)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="beat-date-row">
        <input
          className={`beat-date${dateErr ? ' err' : ''}`}
          key={'d' + beat.key + beat.approx}
          defaultValue={formatDateInput(beat) + (beat.hour !== undefined ? ` ${String(beat.hour).padStart(2, '0')}:${String(beat.minute ?? 0).padStart(2, '0')}` : '')}
          placeholder={`-8, 0 d12, ~-1000000${ix.config.resolved.active.months ? `, 14 ${ix.config.resolved.active.months[0].name} ${ix.config.resolved.active.offset}` : ''}`}
          title="Story years: -8, 0 d12, 0 d12 13:45, ~-1000000. Calendar dates: 14 <Month> <year> [hh:mm]"
          onBlur={(e) => {
            const d = parseWhen(ix.config, e.currentTarget.value)
            setDateErr(!d)
            if (d) redateEvent(beat.id, redate(text, d, 'start', true, true))
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="beat-date-human">{formatWhen(ix.config, beat)}</span>
      </div>
      <DatePickers beat={beat} onDate={(d) => redateEvent(beat.id, redate(text, d, 'start', false, true))} />
      <div className="insp-actions">
        <button className="chip-btn primary" onClick={() => st().showOnTimeline(beat.key)}>
          Show on timeline
        </button>
        <button className="chip-btn" onClick={() => st().openFile(beat.id)}>
          Open in Files
        </button>
        <button
          className="chip-btn"
          onClick={() => deleteEvent(beat.id)}
        >
          Delete event
        </button>
      </div>

      <MainEventField beat={beat} />
      <SubEventsField beat={beat} />

      <div className="field">
        <label>Characters</label>
        <div className="tokens">
          {rawChars.map((c, i) => {
            const id = ix.resolveEntity(c, beat.id)
            return (
              <span key={c + i} className="token">
                <button className="token-main" onClick={() => id && st().openCharacter(id)}>
                  {linkName(c)}
                </button>
                <button className="token-x" onClick={() => write({ characters: rawChars.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </span>
            )
          })}
          <select
            className="token-add"
            value=""
            onChange={(e) => e.target.value && write({ characters: [...rawChars, linkOf(e.target.value)] })}
          >
            <option value="">+ add</option>
            {chars.filter((c) => !beat.characters.includes(c.id)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Place</label>
        <div className="tokens">
          <select className="field-select" value={beat.location ?? ''} onChange={(e) => write({ location: e.target.value ? linkOf(e.target.value) : undefined, ...(e.target.value ? {} : { move: undefined }) })}>
            <option value="">None</option>
            {locs.map((l: Location) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.kind}
              </option>
            ))}
          </select>
          {beat.location && (
            <button
              className="chip-btn"
              onClick={() => {
                const l = ix.entities.get(beat.location!) as Location
                st().select(l.id)
                st().setMapFocus(l.parent ?? null)
                st().setView('map')
              }}
            >
              Show on map
            </button>
          )}
        </div>
      </div>

      {beat.location && (
        <div className="field">
          <label>Movement</label>
          <div className="seg small">
            {['—', ...MOVES].map((m) => (
              <button key={m} className={(beat.move ?? '—') === m ? 'on' : ''} onClick={() => write({ move: m === '—' ? undefined : m })}>
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {ix.config.timelines.length > 0 && (
        <div className="field">
          <label>Threads</label>
          <div className="tokens">
            {ix.config.timelines.map((t) => {
              const on = beat.timelines.includes(t.slug)
              return (
                <button key={t.slug} className={`chip${on ? ' on' : ''}`} onClick={() => write({ timelines: on ? beat.timelines.filter((s) => s !== t.slug) : [...beat.timelines, t.slug] })}>
                  {t.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="field two">
        <div>
          <label>Status</label>
          <input className="field-input" key={'s' + beat.status} defaultValue={beat.status ?? ''} placeholder="provisional" onBlur={(e) => e.currentTarget.value !== (beat.status ?? '') && write({ status: e.currentTarget.value || undefined })} />
        </div>
        <div>
          <label>Approximate</label>
          <button className={`chip${beat.approx ? ' on' : ''}`} onClick={() => write({ approx: beat.approx ? undefined : true })}>
            {beat.approx ? 'yes' : 'no'}
          </button>
        </div>
      </div>
      <div className="field">
        <label>One-line description</label>
        <input className="field-input" key={'x' + beat.description} defaultValue={beat.description ?? ''} onBlur={(e) => e.currentTarget.value !== (beat.description ?? '') && write({ description: e.currentTarget.value || undefined })} />
      </div>
      <div className="field">
        <label>Notes</label>
        <div className="beat-body">
          <Editor
            docKey={beat.id}
            value={body}
            eol={splitNote(text).eol}
            getIndex={() => useStore.getState().index}
            onChange={(b) => {
              setBody(b)
              clearTimeout((window as any).__beatSave)
              ;(window as any).__beatSave = setTimeout(() => {
                const cur = useStore.getState().files.get(beat.id)
                if (typeof cur === 'string') writeFile(beat.id, joinNote({ ...splitNote(cur), body: b }))
              }, 600)
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** Month / day / year (+ optional time) pickers in the active calendar. */
function DatePickers({ beat, onDate }: { beat: Beat; onDate(d: { year: number; day?: number; hour?: number; minute?: number }): void }) {
  const cfg = useStore((s) => s.index!.config)
  const cal = cfg.resolved.active
  const c = toCal(cal, beat.key)
  const yearOnly = beat.day === undefined
  const commit = (patch: Partial<{ year: number; month: number; day: number; time: string }>) => {
    const year = patch.year ?? c.year
    const month = patch.month ?? c.month ?? 0
    const maxDay = cal.months ? cal.months[month].days : cal.daysPerYear
    const day = Math.min(maxDay, Math.max(1, patch.day ?? c.day))
    let hour: number | undefined = beat.hour !== undefined ? c.hour : undefined
    let minute: number | undefined = beat.hour !== undefined ? c.minute : undefined
    if (patch.time !== undefined) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(patch.time.trim())
      if (!patch.time.trim()) (hour = undefined), (minute = undefined)
      else if (m && Number(m[1]) < cal.hoursPerDay && Number(m[2]) < 60) (hour = Number(m[1])), (minute = Number(m[2]))
      else return
    }
    const key = fromCal(cal, { year, month, day, hour, minute })
    const s = keyToStored(key)
    onDate(hour === undefined ? { year: s.year, day: s.day } : { ...s, hour: s.hour ?? 0 })
  }
  return (
    <div className="date-pickers" key={beat.key}>
      <input className="field-input dp-day" type="number" min={1} defaultValue={yearOnly ? '' : c.day} placeholder="day" onBlur={(e) => e.currentTarget.value && commit({ day: Number(e.currentTarget.value) })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {cal.months && (
        <select className="field-select dp-month" value={yearOnly ? '' : c.month} onChange={(e) => e.target.value !== '' && commit({ month: Number(e.target.value) })}>
          {yearOnly && <option value="">month</option>}
          {cal.months.map((m, i) => (
            <option key={i} value={i}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <input className="field-input dp-year" type="number" defaultValue={c.year} onBlur={(e) => e.currentTarget.value !== String(c.year) && commit({ year: Number(e.currentTarget.value) })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <span className="muted dp-label">{cal.after || cal.before ? (c.year >= (cal.hasYearZero ? 0 : 1) ? cal.after : cal.before) : cfg.calendars.length ? '' : 'story year'}</span>
      <input className="field-input dp-time" placeholder="hh:mm" defaultValue={beat.hour !== undefined ? `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` : ''} onBlur={(e) => commit({ time: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
    </div>
  )
}

export { patchFrontmatter }
