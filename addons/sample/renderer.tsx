import { useState } from 'react'
import type { AddonApi } from '../../src/renderer/src/addons/host'

export default function activate(api: AddonApi) {
  let showBadge: (on: boolean) => void = () => {}
  function View() {
    const [reply, setReply] = useState('')
    const view = api.store((s) => s.view)
    return (
      <div className="sample-addon" style={{ padding: 48 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>Sample add-on</h1>
        <p style={{ color: 'var(--text-2)' }}>This view comes from an add-on. Current view id: {view}</p>
        <button className="chip-btn" onClick={async () => setReply(await api.ipc.invoke('ping', 'hello'))}>
          Ask the add-on's main process
        </button>
        <p className="sample-reply">{reply}</p>
      </div>
    )
  }
  function Badge() {
    const [on, setOn] = useState(false)
    showBadge = setOn
    return on ? (
      <div className="sample-badge" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px', borderRadius: 999, background: 'var(--accent-dim)', color: 'var(--accent-hi)', zIndex: 50 }} onClick={() => setOn(false)}>
        Sample overlay · click to hide
      </div>
    ) : null
  }
  api.views.register({ id: 'main', title: 'Sample', component: View })
  api.settings.register({ title: 'Sample add-on', render: () => <p className="sample-settings">Settings pane from the sample add-on.</p> })
  api.commands.register({ id: 'badge', title: 'Sample: show overlay', detail: 'from the sample add-on', shortcut: 'mod+shift+y', run: () => showBadge(true) })
  api.overlays.register({ id: 'badge', component: Badge })
}
