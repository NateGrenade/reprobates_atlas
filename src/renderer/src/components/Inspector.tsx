import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type MouseEvent } from 'react'
import { patchFrontmatter } from '@core/note'
import { moveVaultPath } from '../files/move'
import { removeLocation } from '../map/removeLocation'
import { useStore } from '../store'
import { renderMarkdown } from './markdown'
import { IconClose, IconTarget } from './Icons'
import type { Location } from '@core/vault'
import { timelineBeats, whoIsHere } from '@core/timeline'
import { formatWhen } from '@core/config'
import { BeatEditor } from '../timeline/BeatEditor'
import { createEvent, linkFor } from '../timeline/create'
import { LocationPanel } from '../map/LocationPanel'

const KIND_LABEL: Record<string, string> = { character: 'Character', location: 'Location', faction: 'Faction', item: 'Item', event: 'Event' }
const HIDDEN_KEYS = new Set(['type', 'description', 'status', 'source'])

export function Inspector() {
  const open = useStore((s) => s.inspectorOpen)
  const selected = useStore((s) => s.selected)
  const setOpen = useStore((s) => s.setInspectorOpen)
  return (
    <motion.aside
      className="inspector"
      initial={false}
      animate={{ width: open ? 392 : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="inspector-head">
        <span>Inspector</span>
        <button className="chip-btn" style={{ border: 0, padding: '0 6px' }} onClick={() => setOpen(false)} aria-label="Close inspector">
          <IconClose />
        </button>
      </div>
      <div className="inspector-body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selected ?? 'none'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {selected ? <EntityPanel id={selected} /> : <EmptyInspector />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  )
}

function EmptyInspector() {
  return (
    <p className="empty-hint">
      <em>Nothing selected.</em>
      <br />
      Select a place, a person or a moment anywhere in the Atlas and its lore appears here.
    </p>
  )
}

function EntityPanel({ id }: { id: string }) {
  const beat = useStore((s) => s.index?.beats.find((b) => b.id === id))
  if (beat) return <BeatEditor beat={beat} />
  return <EntityDetails id={id} />
}

function EntityDetails({ id }: { id: string }) {
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const ix = useStore((s) => s.index)
  const select = useStore((s) => s.select)
  const setView = useStore((s) => s.setView)
  const setMapFocus = useStore((s) => s.setMapFocus)
  const vault = useStore((s) => s.vault)
  const note = ix?.notes.get(id)
  const entity = ix?.entities.get(id)
  const lorePath = entity?.source?.path ?? id
  const html = useMemo(() => (ix ? renderMarkdown(ix.loreOf(id), ix, lorePath) : ''), [ix, id, lorePath])
  if (!ix || !note) return <p className="empty-hint">This note no longer exists.</p>
  const data = note.fm.data
  const kind = entity ? (entity.type === 'location' ? (entity as Location).kind : KIND_LABEL[entity.type]) : 'Note'
  const backlinks = ix.backlinks(id)
  const props = Object.entries(data).filter(([k]) => !HIDDEN_KEYS.has(k))

  const onProseClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.wikilink') as HTMLElement | null
    if (!a) return
    e.preventDefault()
    const path = a.dataset.path
    if (!path) return
    const heading = a.dataset.heading
    const ent = heading ? ix.resolveEntity(`[[${a.dataset.target}#${heading}]]`, lorePath) : null
    select(ent ?? path)
  }
  const rename = async (value: string) => {
    const name = value.trim().replace(/\.md$/i, '')
    if (!name || /[/\\]/.test(name) || name === '.' || name === '..') { setRenameError('Enter a valid name without slashes.'); return }
    const to = id.slice(0, id.lastIndexOf('/') + 1) + name + '.md'
    const state = useStore.getState()
    if ([...state.files.keys(), ...state.dirs].some((p) => p.toLowerCase() === to.toLowerCase() && p !== id)) { setRenameError('A file with that name already exists.'); return }
    try {
      const ok = await moveVaultPath(id, to, (text) => patchFrontmatter(text, 'title', name))
      if (ok) { setRenaming(false); setRenameError('') }
    } catch (e: any) { setRenameError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  const showOnMap = () => {
    const loc = ix.entities.get(id) as Location
    setMapFocus(loc.parent ?? null)
    setView('map')
  }
  const openInObsidian = () => {
    if (!vault) return
    window.atlas.openExternal(`obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(id.replace(/\.md$/, ''))}`)
  }

  return (
    <>
      <div className="insp-kicker">
        <span className="dot" />
        {kind}
        {typeof data.status === 'string' && <span style={{ color: 'var(--text-4)' }}>· {data.status}</span>}
      </div>
      {entity?.type === 'location' && renaming ? (
        <div className="insp-rename">
          <input className="info-v" aria-label="Location name" autoFocus defaultValue={entity.name} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => {
            if (e.key === 'Enter') void rename(e.currentTarget.value)
            if (e.key === 'Escape') { setRenaming(false); setRenameError('') }
          }} />
          {renameError && <span role="alert">{renameError}</span>}
        </div>
      ) : <div className="insp-title-row"><h2 className="insp-title">{entity?.name ?? note.name}</h2>{entity?.type === 'location' && <button className="chip-btn" aria-label="Rename location" onClick={() => setRenaming(true)}>Rename</button>}</div>}
      {typeof data.description === 'string' && <p className="insp-desc">{data.description}</p>}
      <div className="insp-actions">
        {entity?.type === 'location' && (
          <button className="chip-btn primary" onClick={showOnMap}>
            <IconTarget /> Show on map
          </button>
        )}
        <button className="chip-btn" onClick={() => useStore.getState().openFile(entity?.source?.path ?? id, entity?.source?.heading ?? null)}>
          Open in Files
        </button>
        <button className="chip-btn" onClick={openInObsidian}>
          Open in Obsidian
        </button>
        {entity?.type === 'location' && (
          <button className="chip-btn danger remove-place" onClick={() => removeLocation(entity as Location)}>
            Remove place
          </button>
        )}
      </div>
      {entity?.type === 'location' && <WhoIsHere id={id} />}
      {entity?.type === 'location' && <LocationPanel loc={entity as Location} />}
      {entity && (entity.type === 'character' || entity.type === 'location') && <EntityTimeline id={id} kind={entity.type} />}
      {props.length > 0 && (
        <div className="insp-section">
          <h4>Properties</h4>
          <dl className="props">
            {props.map(([k, v]) => (
              <PropRow key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      )}
      <div className="insp-section">
        <h4>{entity?.source ? `Lore · ${entity.source.path.split('/').pop()?.replace(/\.md$/, '')}` : 'Lore'}</h4>
        <div className="prose" onClick={onProseClick} dangerouslySetInnerHTML={{ __html: html || '<p style="color:var(--text-3)">No lore written yet.</p>' }} />
      </div>
      {backlinks.length > 0 && (
        <div className="insp-section">
          <h4>Linked from</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {backlinks.map((b) => (
              <button key={b} className="crumb" style={{ textAlign: 'left', padding: '5px 0' }} onClick={() => select(b)}>
                {b.split('/').pop()!.replace(/\.md$/, '')}
                <span style={{ color: 'var(--text-4)', marginLeft: 8 }}>{b.split('/').slice(0, -1).join(' / ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function WhoIsHere({ id }: { id: string }) {
  const ix = useStore((s) => s.index)!
  const t = useStore((s) => s.timeCursor)
  const people = whoIsHere(ix, id, t)
  return (
    <div className="insp-section">
      <h4>Here at the time cursor</h4>
      {people.length === 0 ? (
        <p className="empty-hint" style={{ fontSize: 'calc(12.5px * var(--ui-scale))' }}>No one.</p>
      ) : (
        <div className="tokens">
          {people.map((p) => (
            <span key={p} className="token">
              <button className="token-main" style={{ paddingRight: 10 }} onClick={() => useStore.getState().openCharacter(p)}>
                {ix.entities.get(p)?.name}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function EntityTimeline({ id, kind }: { id: string; kind: 'character' | 'location' }) {
  const ix = useStore((s) => s.index)!
  const sel = useStore.getState
  const beats = timelineBeats(ix, kind === 'character' ? { kind: 'character', id } : { kind: 'location', id })
  return (
    <div className="insp-section">
      <h4>
        Timeline <span style={{ color: 'var(--text-4)', letterSpacing: 0 }}>· {beats.length}</span>
      </h4>
      {beats.length === 0 ? (
        <p className="empty-hint" style={{ fontSize: 'calc(12.5px * var(--ui-scale))' }}>No events yet.</p>
      ) : (
        <ol className="mini-timeline">
          {beats.map((b) => (
            <li key={b.id}>
              <button onClick={() => sel().select(b.id)}>
                <span className="mt-date">{formatWhen(ix.config, b)}</span>
                <span className="mt-title">{b.title}</span>
                {kind === 'location' && b.location !== id && b.location && <span className="mt-sub">{ix.entities.get(b.location)?.name}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="insp-actions" style={{ marginTop: 10 }}>
        <button className="chip-btn primary" onClick={() => createEvent(kind === 'character' ? { characters: [linkFor(id)] } : { location: linkFor(id) })}>
          + Add event
        </button>
        <button className="chip-btn" onClick={() => sel().showOnTimeline(beats[0]?.key ?? null, kind === 'character' ? { character: id } : { location: id })}>
          Show on timeline
        </button>
      </div>
    </div>
  )
}

function PropRow({ k, v }: { k: string; v: unknown }) {
  const text = Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
  return (
    <>
      <dt>{k}</dt>
      <dd>{text.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t, a) => a ?? t)}</dd>
    </>
  )
}
