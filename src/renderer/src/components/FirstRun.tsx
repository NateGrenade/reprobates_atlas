// First run: open or clone the vault, check git, explain sync. Plus the "new version" notice (D7).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function FirstRun() {
  const load = useStore((s) => s.load)
  const [git, setGit] = useState<string | null | undefined>(undefined)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('My World')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => void window.atlas.gitVersion().then(setGit), [])
  const clone = async () => {
    setBusy(true)
    setErr(null)
    try {
      const v = await window.atlas.cloneVault(url.trim())
      if (v) load(v)
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }
  const create = async () => {
    setBusy(true)
    setErr(null)
    try {
      const v = await window.atlas.createNewVault(name.trim())
      if (v) load(v)
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }
  return (
    <div className="placeholder">
      <motion.div className="first-run" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
        <div className="ph-title">Reprobates Atlas</div>
        <p className="ph-sub" style={{ maxWidth: 460 }}>The map, timeline and characters of the Reprobates vault. Everything stays as plain files in the vault, so Obsidian keeps working.</p>
        <div className="fr-steps">
          <div className="fr-step">
            <h4>1 · Open the vault</h4>
            <button className="chip-btn primary" disabled={busy} onClick={() => window.atlas.openVault('pick').then(load)}>
              Choose the vault folder…
            </button>
            <div className="fr-or">or clone it</div>
            <div className="fr-clone">
              <input className="field-input" placeholder="https://github.com/…/Reprobates.git" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="chip-btn" disabled={!url.trim() || busy || !git} onClick={clone}>
                {busy ? 'Cloning…' : 'Clone'}
              </button>
            </div>
            <div className="fr-or">or start a new vault</div>
            <div className="fr-clone">
              <input className="field-input" aria-label="New vault name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="chip-btn" disabled={!name.trim() || busy} onClick={create}>Create…</button>
            </div>
            {err && <div className="add-err" style={{ padding: '8px 0 0' }}>{err}</div>}
          </div>
          <div className="fr-step">
            <h4>2 · Git</h4>
            <p className="muted">{git === undefined ? 'Checking…' : git ? `${git} found. Sync will work.` : 'Git was not found. Install it (macOS: run "xcode-select --install"; Windows: git-scm.com), or set sync to Off and let Obsidian sync.'}</p>
          </div>
          <div className="fr-step">
            <h4>3 · Sync</h4>
            <p className="muted">Auto (default) pulls every 2 minutes and pushes the files this app changed 30 seconds after you stop editing. It never stages other files and stops to ask if a change conflicts. Switch to Manual or Off from the light at the bottom of the left rail.</p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export function UpdateNotice() {
  const [u, setU] = useState<{ version: string; action: 'download' | 'install-on-quit' } | null>(null)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => window.atlas.update.onAvailable((next) => { setU(next); setStarted(false); setError('') }), [])
  return (
    <AnimatePresence>
      {u && (
        <motion.div className="update-notice" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <div>
            <div className="un-title">Version {u.version} is available</div>
            <div className="muted" style={{ fontSize: 'calc(11.5px * var(--ui-scale))' }}>{error || (u.action === 'install-on-quit' ? 'Downloaded and ready. The app updates when you quit. Vault sync is separate.' : started ? 'Download started. When it finishes, open the .dmg and drag Atlas to Applications.' : 'Download the new app. Your vault and its GitHub sync stay in their own folder.')}</div>
          </div>
          {!started && u.action === 'download' ? (
            <button className="chip-btn primary" onClick={async () => {
              try { if (await window.atlas.update.download()) setStarted(true) }
              catch (e: any) { setError(String(e.message ?? e)) }
            }}>
              Download
            </button>
          ) : null}
            <button className="chip-btn" onClick={() => setU(null)}>
              Close
            </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
