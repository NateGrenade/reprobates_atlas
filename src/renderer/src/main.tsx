import { createRoot } from 'react-dom/client'
import './styles/app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)

// Test hook for scripted checks (dev builds or ATLAS_SCRIPT runs only)
import { useStore } from './store'
import './live'
if (import.meta.env.DEV || window.atlas.devFlags?.script) (window as any).__atlas = { store: useStore }
