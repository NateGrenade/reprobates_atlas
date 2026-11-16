// Built-in Settings sections. App-level choices go to userData settings.json (store.setPrefs);
// vault-level ones are files in the vault (Atlas/view.json for lanes).
import { useEffect, useState, type ReactNode } from 'react'
import { APP_NAME, PATHS, parseView, type LanePref } from '@core/config'
import { useStore, type TextSize, type View } from '../store'
import { saveLanePref } from '../timeline/viewPrefs'
import { IconFiles, IconTimeline } from '../components/Icons'
import { registerSettingsSection } from './registry'
import { setAddonEnabled, useAddonHost } from '../addons/host'

const ico = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="prefs-row">
      <div className="prefs-row-k">{label}</div>
      <div className="prefs-row-v">
        <div className="prefs-row-c">{children}</div>
        {hint && <div className="prefs-hint">{hint}</div>}
      </div>
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange(v: T): void; label: string }) {
  return (
    <div className="seg small" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function General() {
  const vault = useStore((s) => s.vault)
  const prefs = useStore((s) => s.prefs)
  const reveal = window.atlas.platform === 'darwin' ? 'Reveal in Finder' : window.atlas.platform === 'win32' ? 'Show in Explorer' : 'Open folder'
  const openOther = async () => {
    const v = await window.atlas.openVault('pick')
    if (v) useStore.getState().load(v)
  }
  return (
    <>
      <Row label="Vault" hint="The vault is the database: every map place, event, character and setting lives in these files.">
        <div className="prefs-vault">
          <div className="prefs-vault-name">{vault?.name}</div>
          <div className="prefs-path" title={vault?.root}>
            {vault?.root}
          </div>
          <div className="prefs-actions">
            <button className="chip-btn" onClick={openOther}>
              Open another vault…
            </button>
            <button className="chip-btn" onClick={() => window.atlas.revealVault()}>
              {reveal}
            </button>
          </div>
        </div>
      </Row>
      <VaultConnection key={vault?.root} />
      <Row label="Open on launch" hint="The view the app shows when it starts.">
        <Seg<View> label="Open on launch" value={prefs.defaultView ?? 'map'} options={[['map', 'Map'], ['timeline', 'Timeline'], ['characters', 'Characters'], ['files', 'Files']]} onChange={(v) => useStore.getState().setPrefs({ defaultView: v })} />
      </Row>
    </>
  )
}

function VaultConnection() {
  const [status, setStatus] = useState<any>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [publish, setPublish] = useState(false)
  useEffect(() => {
    void window.atlas.sync.get().then(setStatus)
    return window.atlas.sync.onStatus(setStatus)
  }, [])
  const run = async (action: () => Promise<any>, success: string) => {
    setBusy(true)
    setMessage('')
    try { const next = await action(); setStatus(next); setMessage(next?.state === 'error' || next?.state === 'offline' || next?.state === 'conflict' ? next.message : success) }
    catch (e: any) { setMessage(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    setBusy(false)
  }
  return (
    <Row label="Vault sync" hint="Content uses its own GitHub repository. App updates are checked separately in About. Git uses the account already signed in on this computer.">
      <div className="prefs-vault">
        {status?.remote ? <>
          <div className="prefs-path">{status.remote}</div>
          <Seg label="Vault sync mode" value={status.mode} options={[['auto', 'Auto'], ['manual', 'Manual'], ['off', 'Off']]} onChange={(mode) => void run(() => window.atlas.sync.setMode(mode), 'Sync mode saved.')} />
          <div className="prefs-actions">
            <button className="chip-btn" disabled={busy || status.mode === 'off'} onClick={() => void run(() => window.atlas.sync.now(), 'Vault sync finished.')}>{busy ? 'Working…' : 'Sync now'}</button>
            <button className="link-btn" disabled={busy} onClick={() => setPublish(!publish)}>Publish existing files…</button>
          </div>
          {publish && <div className="prefs-hint">
            Publish this vault’s existing files and Git history to the connected empty repository. Ignored and local workspace files are excluded from newly added files. Use this once when setting up a new repository.
            <div className="prefs-actions"><button className="chip-btn primary" disabled={busy} onClick={() => void run(async () => {
              const next = await window.atlas.sync.publishExisting()
              if (next?.state === 'synced') setPublish(false)
              return next
            }, 'Vault published. Choose Auto for ongoing sync.')}>Publish vault</button><button className="chip-btn" onClick={() => setPublish(false)}>Cancel</button></div>
          </div>}
        </> : <>
          <div className="prefs-hint">Connect this vault to its own repository. Connecting does not upload files. To use content already on GitHub, clone that repository from the welcome screen.</div>
          <div className="prefs-actions">
            <input className="field-input" aria-label="Vault repository URL" placeholder="https://github.com/you/your-vault.git" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="chip-btn" disabled={busy || !url.trim()} onClick={() => void run(() => window.atlas.connectRemote(url.trim()), 'Connected. Use Publish existing files for an empty remote, then choose Auto.')}>Connect</button>
          </div>
        </>}
        {message && <div className="prefs-hint" role="status">{message}</div>}
      </div>
    </Row>
  )
}

function Appearance() {
  const prefs = useStore((s) => s.prefs)
  return (
    <>
      <Row label="Text size" hint="Scales the text across the app. Saved on this computer.">
        <Seg<TextSize> label="Text size" value={prefs.textSize ?? 'default'} options={[['small', 'Small'], ['default', 'Default'], ['large', 'Large']]} onChange={(v) => useStore.getState().setPrefs({ textSize: v })} />
      </Row>
      <Row label="Reduce motion" hint="On: the map jumps between levels instead of flying, and views and cards switch without animating. System follows your computer's setting.">
        <Seg label="Reduce motion" value={prefs.reduceMotion ?? 'system'} options={[['system', 'System'], ['on', 'On'], ['off', 'Off']]} onChange={(v) => useStore.getState().setPrefs({ reduceMotion: v })} />
      </Row>
    </>
  )
}

const GROUPS: ['timeline' | 'character' | 'location', string][] = [['timeline', 'Threads'], ['character', 'Characters'], ['location', 'Places']]

function Timeline() {
  const viewText = useStore((s) => s.files.get(PATHS.view))
  const lanes = parseView(typeof viewText === 'string' ? viewText : null).lanes ?? {}
  const describe = (p?: LanePref) => (!p || p.auto ? 'Automatic' : `${p.shown.length} lane${p.shown.length === 1 ? '' : 's'} chosen`)
  return (
    <>
      <p className="prefs-intro">
        Which lanes the timeline shows for each grouping is saved in the vault at <code>{PATHS.view}</code>, so the choice travels with the vault and is the same for everyone who opens it. Change lanes from the timeline’s Lanes menu, + Add lane, or the × on a lane.
      </p>
      {GROUPS.map(([g, label]) => (
        <Row key={g} label={`By ${label.toLowerCase()}`}>
          <span className="prefs-value" data-lanes={g}>
            {describe(lanes[g])}
          </span>
          {lanes[g] && !lanes[g]!.auto && (
            <button className="link-btn" onClick={() => saveLanePref(g, null)}>
              Reset to automatic
            </button>
          )}
        </Row>
      ))}
    </>
  )
}

function Addons() {
  const { list } = useAddonHost()
  if (!list.length)
    return (
      <div className="prefs-empty">
        <em>No add-ons installed.</em>
        <p>Add-ons will appear here once they are installed, each with its own settings pane in this list.</p>
      </div>
    )
  return (
    <>
      {list.map((a) => (
        <Row key={a.id} label={a.name} hint={a.error ? `Could not start: ${a.error}` : a.description}>
          <span className="prefs-value">{a.version ?? ''}</span>
          <Seg label={`${a.name} on or off`} value={a.enabled ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => void setAddonEnabled(a.id, v === 'on')} />
        </Row>
      ))}
      <p className="prefs-note">Add-ons run with the same access as the app itself. Only install ones you trust.</p>
    </>
  )
}

function About() {
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  useEffect(() => void window.atlas.info().then((i) => setVersion(i.version)), [])
  const openContract = () => {
    const st = useStore.getState()
    st.setSettingsOpen(false)
    st.openFile(PATHS.readme)
  }
  return (
    <>
      <div className="prefs-about">
        <div className="prefs-app">{APP_NAME}</div>
        <div className="muted">Version {version}</div>
      </div>
      <Row label="App updates" hint="New app releases come from GitHub. Your vault’s files sync independently.">
        <button className="chip-btn" disabled={checking} onClick={async () => {
          setChecking(true)
          try {
            const result = await window.atlas.update.check()
            if (result.status === 'available') useStore.getState().setSettingsOpen(false)
            setUpdateMessage(result.status === 'up-to-date' ? 'You have the latest release.' : result.status === 'available' ? 'A new release is ready; see the update notice.' : result.message ?? 'Update checking is available in the installed app.')
          } catch (e: any) { setUpdateMessage(String(e.message ?? e)) }
          setChecking(false)
        }}>{checking ? 'Checking…' : 'Check for updates'}</button>
        {updateMessage && <span className="prefs-hint" role="status">{updateMessage}</span>}
      </Row>
      <Row label="Data contract" hint="How the map, timeline, characters and settings are stored as plain files, for Obsidian, git and AI agents.">
        <button className="chip-btn about-contract" onClick={openContract}>
          Open {PATHS.readme}
        </button>
      </Row>
    </>
  )
}

registerSettingsSection({ id: 'general', title: 'General', order: 10, render: () => <General />, icon: ico(<><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>) })
registerSettingsSection({ id: 'appearance', title: 'Appearance', order: 20, render: () => <Appearance />, icon: ico(<><path d="M4 15.5L8.6 4h.8L14 15.5" /><path d="M5.8 11.2h6.4" /><path d="M15 9.5v6" /></>) })
registerSettingsSection({ id: 'timeline', title: 'Timeline', order: 30, render: () => <Timeline />, icon: <IconTimeline width={16} height={16} /> })
registerSettingsSection({ id: 'addons', title: 'Add-ons', order: 80, render: () => <Addons />, icon: ico(<><rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" /><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" /><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" /><path d="M13.75 11v5.5M11 13.75h5.5" /></>) })
registerSettingsSection({ id: 'about', title: 'About', order: 90, render: () => <About />, icon: <IconFiles width={16} height={16} /> })
