import { useEffect } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useStore, type View } from './store'
import { Rail } from './components/Rail'
import { Inspector } from './components/Inspector'
import { FpsMeter } from './components/FpsMeter'
import { MapView } from './map/MapView'
import { FilesView } from './files/FilesView'
import { TimelineView } from './timeline/TimelineView'
import { CharactersView } from './characters/CharactersView'
import { Palette } from './palette/Palette'
import { ConflictBanner } from './components/Sync'
import { FirstRun, UpdateNotice } from './components/FirstRun'
import { Settings } from './components/Settings'
import { Calendars } from './components/Calendars'
import { migrateLanePrefs } from './timeline/viewPrefs'
import { loadPrefs } from './store'
import { Toast } from './components/Toast'
import { LiveAsk } from './components/LiveAsk'
import { loadAddons, useAddonHost } from './addons/host'

export function App() {
  const { view, loading, vault, load, applyChanges, setDirs, setView, reducedMotion, settingsOpen, calendarsOpen } = useStore()
  const motionPref = useStore((s) => s.prefs.reduceMotion)
  const addons = useAddonHost()
  const AddonView = addons.views.find((v) => v.id === view)?.component
  useEffect(() => void loadAddons(), [])
  useEffect(() => {
    // app prefs first, so the launch view and text size apply before the vault shows
    loadPrefs().then(() => window.atlas.openVault('default')).then(load)
    const a = window.atlas.onChanged(applyChanges)
    const b = window.atlas.onDirs(setDirs)
    return () => (a(), b())
  }, [load, applyChanges, setDirs])
  // lane choices used to live in localStorage; move them into the vault once
  useEffect(() => {
    if (vault) void migrateLanePrefs()
  }, [vault?.root])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Cmd/Ctrl+Z outside any text field: undo the most recent of the last 5 deletes
      if (e.key.toLowerCase() === 'z' && !e.shiftKey && !(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')) {
        if (useStore.getState().undoStack.length) {
          e.preventDefault()
          void useStore.getState().runUndo()
        }
        return
      }
      const v = (['map', 'timeline', 'characters', 'files'] as View[])[Number(e.key) - 1]
      if (v) {
        e.preventDefault()
        setView(v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : motionPref === 'off' ? 'never' : 'user'}>
      <div className="app">
        <Rail />
        <main className="stage">
          <ConflictBanner />
          {loading ? (
            <div className="loading-screen">Opening the vault…</div>
          ) : !vault ? (
            <FirstRun />
          ) : (
            <AnimatePresence initial={false}>
              <motion.div
                key={view}
                className="view"
                initial={{ opacity: 0, scale: 0.995 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {AddonView ? <AddonView /> : view === 'map' || view.startsWith('addon:') ? <MapView /> : view === 'files' ? <FilesView /> : view === 'timeline' ? <TimelineView /> : <CharactersView />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
        <Inspector />
        <Palette />
        <UpdateNotice />
        <Toast />
        <LiveAsk />
        {addons.overlays.map((o) => (
          <o.component key={o.id} />
        ))}
        <AnimatePresence>{settingsOpen && <Settings onClose={() => useStore.getState().setSettingsOpen(false)} />}</AnimatePresence>
        <AnimatePresence>{calendarsOpen && vault && <Calendars onClose={() => useStore.getState().setCalendarsOpen(false)} />}</AnimatePresence>
        {import.meta.env.DEV && <FpsMeter />}
      </div>
    </MotionConfig>
  )
}

