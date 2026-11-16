import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useStore, noteName } from '../store'
import { Tree } from './Tree'
import { NotePane } from './NotePane'

function Tabs() {
  const tabs = useStore((s) => s.tabs)
  const open = useStore((s) => s.openNote)
  const { openFile, closeTab } = useStore.getState()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w' && useStore.getState().view === 'files' && useStore.getState().openNote) {
        e.preventDefault()
        useStore.getState().closeTab(useStore.getState().openNote!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!tabs.length) return null
  return (
    <div className="tabs">
      <AnimatePresence initial={false}>
        {tabs.map((p) => (
          <motion.div
            key={p}
            layout
            className={`tab${p === open ? ' on' : ''}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, width: 0, paddingLeft: 0, paddingRight: 0 }}
            transition={{ duration: 0.16 }}
            onMouseDown={(e) => (e.button === 1 ? (e.preventDefault(), closeTab(p)) : openFile(p))}
            title={p}
          >
            <span className="tab-name">{noteName(p)}</span>
            <button className="tab-x" onMouseDown={(e) => (e.stopPropagation(), closeTab(p))} aria-label={`Close ${noteName(p)}`}>
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function FilesView() {
  const openNote = useStore((s) => s.openNote)
  const setPalette = useStore((s) => s.setPaletteOpen)
  return (
    <div className="files-view">
      <Tree />
      <div className="files-main">
        <Tabs />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={openNote ?? 'none'}
            className="files-main-inner"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {openNote ? (
              <NotePane path={openNote} />
            ) : (
              <div className="placeholder">
                <div>
                  <div className="ph-title">Files</div>
                  <p className="ph-sub">
                    Pick a note from the tree, or press <kbd className="kbd">⌘K</kbd> to search.
                  </p>
                  <button className="chip-btn" style={{ marginTop: 16 }} onClick={() => setPalette(true)}>
                    Search the vault
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
