// Sync status in the rail, settings + activity popover, and the conflict banner.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { SyncStatus, Commit } from '@core/sync'
import { useStore, noteName } from '../store'

const LABEL: Record<string, string> = {
  off: 'Sync off · Obsidian handles sync',
  synced: 'Synced',
  pending: 'Changes pending',
  syncing: 'Syncing…',
  conflict: 'Conflict',
  offline: 'Offline',
  local: 'Committed locally (no remote)',
  locked: 'Waiting for another git process',
  error: 'Sync error'
}

function useSync() {
  const [s, setS] = useState<SyncStatus | null>(null)
  useEffect(() => {
    window.atlas.sync.get().then(setS)
    return window.atlas.sync.onStatus(setS)
  }, [])
  return [s, setS] as const
}

export function SyncIndicator() {
  const [s, setS] = useSync()
  const [open, setOpen] = useState(false)
  const [activity, setActivity] = useState<Commit[]>([])
  useEffect(() => {
    if (open) window.atlas.sync.activity().then(setActivity)
  }, [open, s?.lastSync])
  if (!s) return null
  return (
    <>
      <button className={`sync-dot state-${s.state}`} onClick={() => setOpen(!open)} aria-label={LABEL[s.state]}>
        <span />
        <span className="rail-tip">{LABEL[s.state]}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="sync-pop" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
            <div className="sync-head">
              <span className={`sync-led state-${s.state}`} />
              <div>
                <div className="sync-title">{LABEL[s.state]}</div>
                {s.message && <div className="muted" style={{ fontSize: 'calc(11.5px * var(--ui-scale))' }}>{s.message}</div>}
              </div>
            </div>
            <div className="seg" style={{ margin: '12px 0' }}>
              {(['auto', 'manual', 'off'] as const).map((m) => (
                <button key={m} className={s.mode === m ? 'on' : ''} onClick={() => window.atlas.sync.setMode(m).then((x) => x && setS(x))}>
                  {m === 'auto' ? 'Auto' : m === 'manual' ? 'Manual' : 'Off'}
                </button>
              ))}
            </div>
            <p className="muted sync-explain">
              {s.mode === 'auto'
                ? 'Pulls on open and every 2 minutes; commits and pushes the files this app changed 30 s after your last edit.'
                : s.mode === 'manual'
                  ? 'Nothing happens until you press Sync now.'
                  : 'The app never runs git. Use Obsidian (obsidian-git) to sync.'}
            </p>
            {s.mode !== 'off' && (
              <button className="chip-btn primary" onClick={() => window.atlas.sync.now().then((x) => x && setS(x))} disabled={s.state === 'syncing' || s.state === 'conflict'}>
                Sync now{s.pending.length ? ` · ${s.pending.length} pending` : ''}
              </button>
            )}
            {s.mode !== 'off' && (
              <div className="insp-section">
                <h4>Recent changes</h4>
                <div className="activity">
                  {activity.slice(0, 12).map((c) => (
                    <div key={c.hash} className="act">
                      <div className="act-top">
                        <span className="act-who">{c.author}</span>
                        <span className="muted">{c.when}</span>
                      </div>
                      <div className="act-subj">{c.subject}</div>
                      <div className="act-files">
                        {c.files.slice(0, 5).map((f) => (
                          <button key={f} onClick={() => (setOpen(false), openChanged(f))}>
                            {noteName(f)}
                          </button>
                        ))}
                        {c.files.length > 5 && <span className="muted">+{c.files.length - 5}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** "What changed" link: open the entity in its natural view, else the note in Files. */
function openChanged(path: string) {
  const st = useStore.getState()
  const e = st.index?.entities.get(path)
  const beat = st.index?.beats.find((b) => b.id === path)
  if (beat) return st.select(path), st.showOnTimeline(beat.key)
  if (e?.type === 'character') return st.openCharacter(path)
  if (e?.type === 'location') return st.select(path), st.setView('map')
  if (st.files.has(path) && path.endsWith('.md')) return st.openFile(path), st.select(path)
}

export function ConflictBanner() {
  const [s, setS] = useSync()
  const [both, setBoth] = useState<{ path: string; mine: string; theirs: string } | null>(null)
  if (!s || s.state !== 'conflict' || !s.conflicts.length) return null
  return (
    <>
      <motion.div className="conflict-banner" style={{ x: '-50%' }} initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <div className="cb-title">
          Sync paused: {s.conflicts.length} file{s.conflicts.length > 1 ? 's' : ''} changed both here and by someone else. Nothing is lost; choose a version for each.
        </div>
        {s.conflicts.map((p) => (
          <div key={p} className="cb-row">
            <span className="cb-file">{p}</span>
            <button className="chip-btn" onClick={() => window.atlas.sync.resolve(p, 'mine').then((x) => x && setS(x))}>
              Keep mine
            </button>
            <button className="chip-btn" onClick={() => window.atlas.sync.resolve(p, 'theirs').then((x) => x && setS(x))}>
              Keep theirs
            </button>
            <button className="chip-btn primary" onClick={() => window.atlas.sync.both(p).then((b) => b && setBoth({ path: p, ...b }))}>
              Open both
            </button>
          </div>
        ))}
      </motion.div>
      <AnimatePresence>
        {both && (
          <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setBoth(null)}>
            <motion.div className="both" onMouseDown={(e) => e.stopPropagation()} initial={{ y: -10 }} animate={{ y: 0 }}>
              <div className="both-head">{both.path}</div>
              <div className="both-cols">
                <div>
                  <h4>Mine</h4>
                  <pre>{both.mine}</pre>
                </div>
                <div>
                  <h4>Theirs</h4>
                  <pre>{both.theirs}</pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
