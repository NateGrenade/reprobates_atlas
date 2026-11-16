// One toast at a time, bottom centre, with an optional Undo. Auto-hides after 7 s.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useStore } from '../store'

export function Toast() {
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useStore.getState().toast?.id === toast.id && useStore.setState({ toast: null }), 7000)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast.id} className="toast-bar" initial={{ opacity: 0, y: 14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 8, x: '-50%' }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              className="toast-undo"
              onClick={() => useStore.getState().runUndo(toast.id)}
            >
              Undo
            </button>
          )}
          <button className="toast-x" onClick={() => useStore.setState({ toast: null })} aria-label="Dismiss">
            ×
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
