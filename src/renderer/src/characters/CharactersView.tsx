import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Entity, Location, VaultIndex } from '@core/vault'
import { patchFrontmatter, patchFrontmatterMany } from '@core/note'
import { timelineBeats, positionAt } from '@core/timeline'
import { formatWhen } from '@core/config'
import { PATHS } from '@core/config'
import { useStore, vaultUrl, noteName } from '../store'
import { renderMarkdown } from '../components/markdown'
import { AddCharacter } from './AddCharacter'
import { createEvent, linkFor } from '../timeline/create'
import { restoreKeys } from '../timeline/eventOps'

const EASE = [0.22, 1, 0.36, 1] as const
const CORE_KEYS = new Set(['type', 'portrait', 'aliases', 'role', 'affiliation', 'species', 'born_year', 'status', 'description', 'source', 'title', 'card_style'])
/** Keys that only exist for the character card; removing a character clears them (and `type`). */
const CARD_KEYS = ['type', 'portrait', 'role', 'affiliation', 'species', 'born_year', 'card_style']
export const CARD_STYLES = [
  ['protagonist', 'Protagonist'],
  ['antagonist', 'Antagonist'],
  ['secondary', 'Secondary'],
  ['supporting', 'Supporting'],
  ['ally', 'Ally'],
  ['enigma', 'Enigma']
] as const
const styleOf = (e: Entity) => (CARD_STYLES.some(([k]) => k === e.data.card_style) ? String(e.data.card_style) : 'supporting')

/** Remove a character: a tagged note loses only its card keys (lore kept); a heading stub is trashed. Undo restores. */
export async function removeCharacter(e: Entity) {
  const st = useStore.getState()
  const text = st.files.get(e.id)
  if (typeof text !== 'string') return
  const stub = !!e.source && e.id.startsWith(PATHS.entities + '/')
  const msg = stub
    ? `Remove ${e.name} from Characters?\n\nThis deletes the small stub file ${e.id} (moved to the trash). The lore in ${noteName(e.source!.path)} is not touched.`
    : `Remove ${e.name} from Characters?\n\nThe lore note ${e.id} is kept. Only its character keys are removed: ${CARD_KEYS.filter((k) => e.data[k] !== undefined).join(', ')}.`
  if (!window.confirm(msg)) return
  if (st.characterOpen === e.id) st.openCharacter(null)
  if (stub) {
    await window.atlas.trash(e.id)
    st.applyChanges([[e.id, false]])
    st.showToast(`Removed ${e.name}`, () => restoreKeys(e.id, text, null, CARD_KEYS), true)
  } else {
    const stripped = patchFrontmatterMany(text, Object.fromEntries(CARD_KEYS.map((k) => [k, undefined])))
    await st.writeFile(e.id, stripped)
    st.showToast(`Removed ${e.name} from Characters (note kept)`, () => restoreKeys(e.id, text, stripped, CARD_KEYS), true)
  }
}
const unlink = (s: unknown) => String(s).replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, (_m, t, h, a) => a ?? h ?? t)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : [String(v)])

export function characters(ix: VaultIndex): Entity[] {
  return [...ix.entities.values()].filter((e) => e.type === 'character')
}

function usePortrait(e: Entity) {
  const ver = useStore((s) => (typeof e.data.portrait === 'string' ? s.binaryVersion[e.data.portrait] : undefined))
  const has = useStore((s) => typeof e.data.portrait === 'string' && s.files.has(e.data.portrait))
  return has ? vaultUrl(e.data.portrait as string) + (ver ? `?v=${ver}` : '') : null
}

export function CharactersView() {
  const ix = useStore((s) => s.index)!
  const open = useStore((s) => s.characterOpen)
  const openCharacter = useStore((s) => s.openCharacter)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'name' | 'status' | 'moments'>('name')
  const [adding, setAdding] = useState(false)
  const all = useMemo(() => characters(ix), [ix])
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const f = all.filter((c) => !ql || [c.name, c.data.role, ...list(c.data.aliases), ...list(c.data.affiliation)].some((s) => s && unlink(s).toLowerCase().includes(ql)))
    const count = (c: Entity) => timelineBeats(ix, { kind: 'character', id: c.id }).length
    return f.sort((a, b) =>
      sort === 'status' ? String(a.data.status ?? '~').localeCompare(String(b.data.status ?? '~')) || a.name.localeCompare(b.name) : sort === 'moments' ? count(b) - count(a) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)
    )
  }, [all, q, sort, ix])
  const openEntity = open ? ix.entities.get(open) : undefined

  return (
    <LayoutGroup>
      <div className="chars">
        <div className="chars-toolbar">
          <div className="tl-title">Characters</div>
          <input className="chars-search" placeholder="Filter by name, role, affiliation…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {(['name', 'status', 'moments'] as const).map((s) => (
              <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
                {s === 'name' ? 'Name' : s === 'status' ? 'Status' : 'Most events'}
              </button>
            ))}
          </div>
          <div className="tl-spacer" />
          <button className="chip-btn primary" onClick={() => setAdding(true)}>
            + Add character
          </button>
        </div>
        <div className="chars-scroll">
          {shown.length === 0 ? (
            <div className="placeholder" style={{ height: '70%' }}>
              <div>
                <div className="ph-title">{all.length ? 'No one matches' : 'No characters yet'}</div>
                <p className="ph-sub">{all.length ? 'Try another filter.' : 'Tag an existing note as a character, create one, or point at a heading.'}</p>
              </div>
            </div>
          ) : (
            <div className="card-grid">
              {shown.map((c, i) => (
                <Card key={c.id} e={c} i={i} hidden={open === c.id} onOpen={() => openCharacter(c.id)} />
              ))}
            </div>
          )}
        </div>
        <AnimatePresence>{openEntity && openEntity.type === 'character' && <Detail key={openEntity.id} e={openEntity} onClose={() => openCharacter(null)} />}</AnimatePresence>
        <AnimatePresence>{adding && <AddCharacter onClose={() => setAdding(false)} />}</AnimatePresence>
      </div>
    </LayoutGroup>
  )
}

function Silhouette() {
  // colours come from the card style (CSS variables --sil-a / --sil-b)
  return (
    <svg className="silhouette" viewBox="0 0 120 160" preserveAspectRatio="xMidYMax slice">
      <circle cx="60" cy="62" r="24" className="sil-shape" />
      <path d="M14 160c2-34 22-54 46-54s44 20 46 54z" className="sil-shape" />
    </svg>
  )
}

function Portrait({ e, layout }: { e: Entity; layout: string }) {
  const url = usePortrait(e)
  return (
    <motion.div layoutId={layout} className="portrait" transition={{ duration: 0.45, ease: EASE }}>
      {url ? <img src={url} alt="" draggable={false} /> : <Silhouette />}
    </motion.div>
  )
}

function Card({ e, i, hidden, onOpen }: { e: Entity; i: number; hidden: boolean; onOpen(): void }) {
  const aff = list(e.data.affiliation).map(unlink)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
    <motion.button
      className={`card style-${styleOf(e)}`}
      data-character={e.id}
      onClick={onOpen}
      onContextMenu={(ev) => {
        ev.preventDefault()
        setMenu({ x: ev.clientX, y: ev.clientY })
      }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: hidden ? 0 : 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease: EASE }}
      whileHover={{ y: -3 }}
    >
      <Portrait e={e} layout={`portrait-${e.id}`} />
      <div className="card-shade" />
      <div className="card-info">
        {typeof e.data.status === 'string' && <span className={`badge status-${e.data.status}`}>{e.data.status}</span>}
        <motion.div layoutId={`name-${e.id}`} className="card-name" transition={{ duration: 0.45, ease: EASE }}>
          {e.name}
        </motion.div>
        <div className="card-role">{[e.data.role, ...aff].filter(Boolean).map(unlink).join(' · ')}</div>
        {typeof e.data.description === 'string' && <div className="card-desc">{e.data.description}</div>}
      </div>
    </motion.button>
    {menu && <CardMenu e={e} at={menu} onOpen={onOpen} onClose={() => setMenu(null)} />}
    </>
  )
}

function CardMenu({ e, at, onOpen, onClose }: { e: Entity; at: { x: number; y: number }; onOpen(): void; onClose(): void }) {
  useEffect(() => {
    const h = (ev: MouseEvent) => !(ev.target as HTMLElement).closest?.('.card-menu') && onClose()
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [onClose])
  return createPortal(
    <div className="ctx-menu card-menu" style={{ position: 'fixed', left: at.x, top: at.y }}>
      <button onClick={() => (onClose(), onOpen())}>Open</button>
      <button onClick={() => (onClose(), useStore.getState().openFile(e.source?.path ?? e.id, e.source?.heading ?? null))}>Open lore in Files</button>
      <button className="danger" onClick={() => (onClose(), removeCharacter(e))}>
        Remove from Characters…
      </button>
    </div>,
    document.body
  )
}

function Detail({ e, onClose }: { e: Entity; onClose(): void }) {
  const ix = useStore((s) => s.index)!
  const cursor = useStore((s) => s.timeCursor)
  const st = useStore.getState
  const [dropping, setDropping] = useState(false)
  const lorePath = e.source?.path ?? e.id
  const html = useMemo(() => renderMarkdown(ix.loreOf(e.id), ix, lorePath), [ix, e.id, lorePath])
  const beats = timelineBeats(ix, { kind: 'character', id: e.id })
  const pos = positionAt(ix, e.id, cursor)
  const posLoc = pos.kind === 'at' ? pos.location : pos.kind === 'transit' ? pos.from : null
  const related = useMemo(() => {
    const n = ix.notes.get(lorePath)
    const out = new Set<string>()
    n?.links.forEach((l) => {
      const p = ix.resolver.resolve(l.target, lorePath)
      if (p && p !== lorePath && p !== e.id) out.add(p)
    })
    ix.backlinks(e.id).forEach((p) => out.add(p))
    return [...out].filter((p) => !p.startsWith(PATHS.timeline + '/')).sort()
  }, [ix, lorePath, e.id])

  const set = (key: string, value: unknown) => {
    const cur = st().files.get(e.id)
    if (typeof cur !== 'string') return
    const next = patchFrontmatter(cur, key, value)
    if (next !== cur) st().writeFile(e.id, next)
  }
  const onDrop = async (ev: DragEvent) => {
    ev.preventDefault()
    setDropping(false)
    const f = [...ev.dataTransfer.files].find((x) => /^image\//.test(x.type))
    if (!f) return
    const ext = (f.name.split('.').pop() || 'png').toLowerCase()
    const slug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'portrait'
    const path = `${PATHS.portraits}/${slug}.${ext}`
    await window.atlas.writeBinary(path, new Uint8Array(await f.arrayBuffer()))
    st().applyChanges([[path, null]])
    st().bumpBinary(path)
    if (e.data.portrait !== path) set('portrait', path)
  }

  const field = (key: string, label: string, opts: { links?: boolean; number?: boolean } = {}) => {
    const v = e.data[key]
    const shown = Array.isArray(v) ? v.map(unlink).join(', ') : v === undefined ? '' : unlink(v)
    return (
      <div className="info-row" key={key}>
        <span className="info-k">{label}</span>
        <input
          className="info-v"
          key={shown}
          defaultValue={shown}
          placeholder="—"
          onBlur={(ev) => {
            const raw = ev.currentTarget.value.trim()
            if (raw === shown) return
            if (!raw) return set(key, undefined)
            if (opts.number) return Number.isFinite(Number(raw)) && set(key, Math.trunc(Number(raw)))
            if (opts.links || Array.isArray(v)) {
              const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
              return set(key, opts.links ? items.map((s) => (s.startsWith('[[') ? s : `[[${s}]]`)) : items)
            }
            set(key, raw)
          }}
          onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()}
        />
      </div>
    )
  }
  const more = Object.entries(e.data).filter(([k]) => !CORE_KEYS.has(k))

  const cardStyle = styleOf(e)
  return (
    <motion.div className={`detail style-${cardStyle}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.25 }}>
      <div className="detail-bg" onClick={onClose} />
      <div className="detail-inner">
        <button className="detail-back" onClick={onClose}>
          ← All characters
        </button>
        <div className="detail-grid">
          <div
            className={`detail-portrait${dropping ? ' drop' : ''}`}
            onDragOver={(ev) => (ev.preventDefault(), setDropping(true))}
            onDragLeave={() => setDropping(false)}
            onDrop={onDrop}
          >
            <Portrait e={e} layout={`portrait-${e.id}`} />
            <div className="drop-hint">{dropping ? 'Drop to set portrait' : 'Drop an image to set the portrait'}</div>
          </div>
          <motion.div className="detail-body" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.12, ease: EASE }}>
            <div className="insp-kicker">
              <span className="dot" />
              Character{typeof e.data.status === 'string' && <span style={{ color: 'var(--text-4)' }}>· {e.data.status}</span>}
            </div>
            <motion.h1 layoutId={`name-${e.id}`} className="detail-name" transition={{ duration: 0.45, ease: EASE }}>
              {e.name}
            </motion.h1>
            {typeof e.data.description === 'string' && <p className="insp-desc">{e.data.description}</p>}
            {e.source && (
              <p className="detail-source">
                From the heading “{e.source.heading}” in{' '}
                <button className="link-btn" onClick={() => st().openFile(e.source!.path, e.source!.heading ?? null)}>
                  {noteName(e.source.path)}
                </button>
              </p>
            )}
            <div className="style-picker" role="radiogroup" aria-label="Card style">
              {CARD_STYLES.map(([k, label]) => (
                <button key={k} role="radio" aria-checked={cardStyle === k} className={`style-chip style-${k}${cardStyle === k ? ' on' : ''}`} onClick={() => set('card_style', k === 'supporting' ? undefined : k)}>
                  <span className="sw" />
                  {label}
                </button>
              ))}
            </div>
            <div className="insp-actions">
              {posLoc && (
                <button
                  className="chip-btn primary"
                  onClick={() => {
                    const l = ix.entities.get(posLoc) as Location
                    st().select(l.id)
                    st().setMapFocus(l.parent ?? null)
                    st().setView('map')
                  }}
                >
                  {pos.kind === 'transit' ? 'Leaving' : 'At'} {ix.entities.get(posLoc)?.name} · Show on map
                </button>
              )}
              <button className="chip-btn" onClick={() => st().showOnTimeline(beats[0]?.key ?? null, { character: e.id })}>
                Show on timeline
              </button>
              <button className="chip-btn" onClick={() => st().openFile(lorePath, e.source?.heading ?? null)}>
                Edit lore in Files
              </button>
              <button className="chip-btn remove-char" onClick={() => removeCharacter(e)}>
                Remove from Characters…
              </button>
            </div>

            <div className="info">
              {field('role', 'Role')}
              {field('affiliation', 'Affiliation', { links: true })}
              {field('species', 'Species')}
              {field('born_year', 'Born (year)', { number: true })}
              {field('aliases', 'Aliases')}
            </div>
            {more.length > 0 && (
              <div className="insp-section">
                <h4>More</h4>
                <div className="info">{more.map(([k]) => field(k, k))}</div>
              </div>
            )}

            <div className="detail-cols">
              <div className="insp-section">
                <h4>{e.source ? `Lore · ${noteName(e.source.path)} › ${e.source.heading}` : 'Lore'}</h4>
                <div
                  className="prose"
                  onClick={(ev) => {
                    const a = (ev.target as HTMLElement).closest('a.wikilink') as HTMLElement | null
                    if (a?.dataset.path) (ev.preventDefault(), st().openFile(a.dataset.path, a.dataset.heading || null))
                  }}
                  dangerouslySetInnerHTML={{ __html: html || '<p class="muted">No lore written yet.</p>' }}
                />
              </div>
              <div>
                <div className="insp-section">
                  <h4>Timeline · {beats.length}</h4>
                  {beats.length ? (
                    <ol className="mini-timeline">
                      {beats.map((b) => (
                        <li key={b.id}>
                          <button onClick={() => (st().select(b.id), st().showOnTimeline(b.key))}>
                            <span className="mt-date">{formatWhen(ix.config, b)}</span>
                            <span className="mt-title">{b.title}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="empty-hint">No events yet.</p>
                  )}
                  <button className="chip-btn primary" style={{ marginTop: 10 }} onClick={() => createEvent({ characters: [linkFor(e.id)] })}>
                    + Add event
                  </button>
                </div>
                <div className="insp-section">
                  <h4>Related notes</h4>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {related.map((p) => (
                      <button key={p} className="backlink" onClick={() => st().openFile(p)}>
                        <span>{noteName(p)}</span>
                        <span className="muted">{p.split('/').slice(0, -1).join(' / ')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}

