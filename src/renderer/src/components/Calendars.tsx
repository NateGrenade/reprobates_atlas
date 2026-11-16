// Calendars editor (from the timeline toolbar's calendar button or Cmd+K "Calendars"). Writes Atlas/atlas.yaml.
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { EARTH_MONTHS, EARTH_WEEKDAYS, formatCal, resolveCalendar, toCal, type CalendarDef } from '@core/calendar'
import { setConfigKeys } from '@core/configEdit'
import { PATHS } from '@core/config'
import { useStore } from '../store'

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calendar'
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export function Calendars({ onClose }: { onClose(): void }) {
  const ix = useStore((s) => s.index)!
  const [cals, setCals] = useState<CalendarDef[]>(() => clone(ix.config.calendars))
  const [active, setActive] = useState<string | undefined>(ix.config.active_calendar)
  const dirty = JSON.stringify(cals) !== JSON.stringify(ix.config.calendars) || active !== ix.config.active_calendar

  const update = (i: number, patch: Partial<CalendarDef>) => setCals((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const add = () => setCals([...cals, { slug: '', name: cals.length ? `Calendar ${cals.length + 1}` : 'Main calendar' }])
  const save = async () => {
    const st = useStore.getState()
    const cur = (st.files.get(PATHS.config) as string | undefined) ?? ''
    // slugs: keep existing ones (other settings refer to them), derive new ones from the name
    const used = new Set<string>()
    const withSlugs = cals.map((c) => {
      let slug = c.slug || slugify(c.name || 'calendar')
      while (used.has(slug)) slug += '-2'
      used.add(slug)
      return { ...c, slug, name: c.name.trim() || slug }
    })
    if (active && !withSlugs.some((c) => c.slug === active)) setActive(undefined)
    const clean = withSlugs.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))))
    const next = setConfigKeys(cur, { calendars: clean, active_calendar: clean.length && active && clean.some((c) => c.slug === active) ? active : undefined })
    await st.writeFile(PATHS.config, next)
    onClose()
  }

  return (
    <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="settings calendars-panel" role="dialog" aria-label="Calendars" initial={{ opacity: 0, y: -10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <div className="tl-title">Calendars</div>
          <span className="muted">Saved in {PATHS.config}, shared with everyone using the vault</span>
        </div>
        <div className="settings-body">
          <p className="muted settings-intro">
            Event times are stored in standard measures from the moment Book 1 begins (365-day years, 24-hour days), so editing a calendar never changes or breaks an event: calendars only change how dates are shown and typed. Every part defaults to Earth.
          </p>
          {cals.length === 0 && <div className="cal-empty">No calendar yet: dates show as story years and day numbers.</div>}
          {cals.map((c, i) => (
            <CalendarCard
              key={i}
              def={c}
              isActive={(active ?? cals[0]?.slug) === c.slug && !!c.slug}
              onChange={(p) => update(i, p)}
              onRemove={() => setCals(cals.filter((_, j) => j !== i))}
              onActivate={() => c.slug && setActive(c.slug)}
            />
          ))}
          <button className="chip-btn" onClick={add}>
            + Add calendar
          </button>
        </div>
        <div className="settings-foot">
          <button className="chip-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="chip-btn primary" disabled={!dirty} onClick={save}>
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ListEditor({ items, onChange, render, add, min = 1 }: { items: any[]; onChange(next: any[]): void; render(item: any, set: (v: any) => void): React.ReactNode; add(): any; min?: number }) {
  const move = (i: number, d: number) => {
    const n = [...items]
    ;[n[i], n[i + d]] = [n[i + d], n[i]]
    onChange(n)
  }
  return (
    <>
      {items.map((it, i) => (
        <div className="month-row" key={i}>
          <span className="muted">{i + 1}</span>
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
          <button className="link-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button className="link-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button className="link-btn danger" disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">×</button>
        </div>
      ))}
      <button className="chip-btn add-row" onClick={() => onChange([...items, add()])}>
        + Add
      </button>
    </>
  )
}

function CalendarCard({ def, isActive, onChange, onRemove, onActivate }: { def: CalendarDef; isActive: boolean; onChange(p: Partial<CalendarDef>): void; onRemove(): void; onActivate(): void }) {
  const [open, setOpen] = useState<'months' | 'weekdays' | 'hours' | null>(null)
  const cal = useMemo(() => resolveCalendar(def), [def])
  const sample = toCal(cal, 44 + 9.5 / 24)
  const months = def.months ?? EARTH_MONTHS
  const weekdays = def.weekdays ?? EARTH_WEEKDAYS
  const num = (v: string) => (v.trim() === '' || v.trim() === '-' ? undefined : Math.trunc(Number(v)) || 0)
  return (
    <div className={`cal-card${isActive ? ' active' : ''}`}>
      <div className="cal-top">
        <label className="cal-name-label">
          Name
          <input className="cal-name" value={def.name} placeholder="Calendar name" onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <button className={`link-btn${isActive ? ' on' : ''}`} onClick={onActivate} disabled={!def.slug} title={def.slug ? '' : 'Save first'}>
          {isActive ? 'shown on timeline' : 'show on timeline'}
        </button>
        <button className="link-btn danger" onClick={onRemove}>
          remove
        </button>
      </div>
      <div className="cal-grid">
        <label>
          Book 1 begins in year
          <input className="field-input" type="number" value={def.year_zero_offset ?? 0} onChange={(e) => onChange({ year_zero_offset: num(e.target.value) })} />
        </label>
        <label>
          on month
          <select className="field-select" value={(def.epoch_month ?? 1) - 1} onChange={(e) => onChange({ epoch_month: Number(e.target.value) + 1 === 1 ? undefined : Number(e.target.value) + 1 })}>
            {months.map((m, i) => (
              <option key={i} value={i}>
                {m.name || `Month ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          day, hour
          <span className="pair">
            <input className="field-input" type="number" min={1} value={def.epoch_day ?? 1} onChange={(e) => onChange({ epoch_day: num(e.target.value) === 1 ? undefined : num(e.target.value) })} />
            <input className="field-input" type="number" min={0} value={def.epoch_hour ?? 0} onChange={(e) => onChange({ epoch_hour: num(e.target.value) || undefined })} />
          </span>
        </label>
        <label>
          Label before
          <input className="field-input" placeholder="e.g. BE" value={def.before_label ?? ''} onChange={(e) => onChange({ before_label: e.target.value || undefined })} />
        </label>
        <label>
          Label after
          <input className="field-input" placeholder="e.g. AE" value={def.after_label ?? ''} onChange={(e) => onChange({ after_label: e.target.value || undefined })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={def.has_year_zero !== false} onChange={(e) => onChange({ has_year_zero: e.target.checked ? undefined : false })} />
          has a year 0
        </label>
      </div>
      <div className="cal-preview">
        Book 1 begins, plus 44 days 9:30 = <b>{formatCal(cal, 44 + 9.5 / 24, { precision: 'minute' })}</b> · {sample.weekday}
        <span className="muted"> · {cal.daysPerYear} days a year, {cal.hoursPerDay} hours a day</span>
      </div>
      <div className="cal-customize">
        {(['months', 'weekdays', 'hours'] as const).map((k) => (
          <button key={k} className={`chip${open === k ? ' on' : ''}`} onClick={() => setOpen(open === k ? null : k)}>
            Customize {k}
            {(k === 'months' ? def.months : k === 'weekdays' ? def.weekdays : def.hours_per_day) ? ' ·' : ''}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            {open === 'months' && (
              <div className="cal-sub">
                {!def.months && <p className="muted">Showing the Earth months. Edit any field to customise.</p>}
                <ListEditor
                  items={months}
                  onChange={(n) => onChange({ months: n })}
                  add={() => ({ name: `Month ${months.length + 1}`, days: 30 })}
                  render={(m, set) => (
                    <>
                      <input className="field-input" value={m.name} onChange={(e) => set({ ...m, name: e.target.value })} />
                      <input className="field-input" type="number" min={1} value={m.days} onChange={(e) => set({ ...m, days: Math.max(1, Number(e.target.value) || 1) })} />
                      <span className="muted">days</span>
                    </>
                  )}
                />
                {def.months && (
                  <button className="chip-btn" onClick={() => onChange({ months: undefined })}>
                    Reset to Earth
                  </button>
                )}
              </div>
            )}
            {open === 'weekdays' && (
              <div className="cal-sub weekdays">
                {!def.weekdays && <p className="muted">Showing the Earth week. Edit any name to customise.</p>}
                <ListEditor
                  items={weekdays}
                  onChange={(n) => onChange({ weekdays: n })}
                  add={() => `Day ${weekdays.length + 1}`}
                  render={(w, set) => <input className="field-input wide" value={w} onChange={(e) => set(e.target.value)} />}
                />
                <label>
                  Book 1 begins on weekday number
                  <input className="field-input" type="number" min={1} max={weekdays.length} value={(def.week_start_offset ?? 0) + 1} onChange={(e) => onChange({ week_start_offset: Math.max(0, (Number(e.target.value) || 1) - 1) || undefined })} />
                </label>
                {def.weekdays && (
                  <button className="chip-btn" onClick={() => onChange({ weekdays: undefined, week_start_offset: undefined })}>
                    Reset to Earth
                  </button>
                )}
              </div>
            )}
            {open === 'hours' && (
              <div className="cal-sub">
                <label>
                  Hours per day (minutes stay 60 per hour; a 20-hour day is 1,200 minutes long)
                  <input className="field-input" type="number" min={1} value={def.hours_per_day ?? 24} onChange={(e) => onChange({ hours_per_day: Number(e.target.value) === 24 ? undefined : Math.max(1, Number(e.target.value) || 24) })} />
                </label>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
