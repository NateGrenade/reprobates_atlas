import { motion } from 'motion/react'
import { useStore, type View } from '../store'
import { IconCharacters, IconFiles, IconMap, IconTimeline } from './Icons'
import { SyncIndicator } from './Sync'
import { useAddonHost } from '../addons/host'

const ITEMS: { id: View; label: string; Icon: typeof IconMap; key: string }[] = [
  { id: 'map', label: 'Map', Icon: IconMap, key: '1' },
  { id: 'timeline', label: 'Timeline', Icon: IconTimeline, key: '2' },
  { id: 'characters', label: 'Characters', Icon: IconCharacters, key: '3' },
  { id: 'files', label: 'Files', Icon: IconFiles, key: '4' }
]

export function Rail() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const addonViews = useAddonHost().views
  return (
    <nav className="rail">
      {ITEMS.map(({ id, label, Icon, key }) => (
        <button key={id} className={`rail-item${view === id ? ' active' : ''}`} onClick={() => setView(id)} aria-label={label}>
          {view === id && <motion.span layoutId="rail-glow" className="rail-glow" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          <Icon />
          <span className="rail-tip">
            {label} <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>⌘{key}</span>
          </span>
        </button>
      ))}
      {addonViews.map((v) => (
        <button key={v.id} className={`rail-item${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id as any)} aria-label={v.title}>
          {view === v.id && <motion.span layoutId="rail-glow" className="rail-glow" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          {v.icon ?? <span className="rail-letter">{v.title.slice(0, 1)}</span>}
          <span className="rail-tip">{v.title}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <button className="rail-item rail-small" onClick={() => useStore.getState().setSettingsOpen(true)} aria-label="Settings">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></svg>
        <span className="rail-tip">Settings</span>
      </button>
      <SyncIndicator />
    </nav>
  )
}
