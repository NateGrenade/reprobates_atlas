// Settings (the gear on the rail): a section list on the left, the section on the right.
// Sections come from the registry (settings/registry.ts), so add-ons can add their own panes.
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useSettingsSections } from '../settings/registry'
import '../settings/sections'
import { IconClose } from './Icons'

export function Settings({ onClose }: { onClose(): void }) {
  const sections = useSettingsSections()
  const [active, setActive] = useState(() => sessionStorage.getItem('atlas.settings.section') ?? sections[0]?.id)
  const cur = sections.find((s) => s.id === active) ?? sections[0]
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const pick = (id: string) => (setActive(id), sessionStorage.setItem('atlas.settings.section', id))
  return (
    <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="prefs" role="dialog" aria-label="Settings" initial={{ opacity: 0, y: -10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(e) => e.stopPropagation()}>
        <nav className="prefs-nav">
          <div className="tl-title prefs-title">Settings</div>
          {sections.map((s) => (
            <button key={s.id} className={`prefs-nav-item${s.id === cur?.id ? ' on' : ''}`} data-section={s.id} onClick={() => pick(s.id)}>
              <span className="prefs-nav-icon">{s.icon}</span>
              {s.title}
            </button>
          ))}
        </nav>
        <section className="prefs-pane" data-pane={cur?.id}>
          <div className="prefs-pane-head">
            <h3>{cur?.title}</h3>
            <button className="prefs-close" onClick={onClose} aria-label="Close settings">
              <IconClose width={16} height={16} />
            </button>
          </div>
          <div className="prefs-pane-body">{cur?.render()}</div>
        </section>
      </motion.div>
    </motion.div>
  )
}
