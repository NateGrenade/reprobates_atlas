import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { EditorView } from '@codemirror/view'
import { joinNote, patchFrontmatter, splitNote } from '@core/note'
import { redateEvent } from '../timeline/eventOps'
import { useStore, noteName, vaultUrl } from '../store'
import { renderMarkdown } from '../components/markdown'
import { Editor, linePrefix, wrap } from './Editor'

type Mode = 'read' | 'edit' | 'source'

export function NotePane({ path }: { path: string }) {
  const text = useStore((s) => s.files.get(path))
  const ix = useStore((s) => s.index)
  const vault = useStore((s) => s.vault)
  const openFile = useStore((s) => s.openFile)
  const heading = useStore((s) => s.openHeading)
  const writeFile = useStore((s) => s.writeFile)
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('atlas.files.mode') as Mode) ?? 'read')
  useEffect(() => localStorage.setItem('atlas.files.mode', mode), [mode])
  const parts = useMemo(() => splitNote(text ?? ''), [text])

  // Editor value only follows the file when the change did not come from this editor.
  const written = useRef<string | null>(null)
  const [editorValue, setEditorValue] = useState(parts.body)
  useEffect(() => {
    written.current = null
    setEditorValue(splitNote(useStore.getState().files.get(path) ?? '').body)
  }, [path])
  useEffect(() => {
    if (parts.body !== written.current) setEditorValue(parts.body)
  }, [parts.body])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const body = pending.current
    pending.current = null
    if (body === null) return
    const cur = useStore.getState().files.get(path)
    if (typeof cur !== 'string') return
    const p = splitNote(cur)
    if (p.body === body) return
    written.current = body
    writeFile(path, joinNote({ ...p, body }))
  }
  useEffect(() => flush, [path]) // flush on note switch / unmount
  const onBodyChange = (body: string) => {
    pending.current = body
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }

  const view = useRef<EditorView | null>(null)
  const html = useMemo(() => (mode === 'read' ? renderMarkdown(parts.body, ix, path) : ''), [mode, parts.body, ix, path])
  const readRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'read' || !heading || !readRef.current) return
    const h = [...readRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((el) => el.textContent?.trim().toLowerCase() === heading.toLowerCase())
    h?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [heading, html, mode])

  if (typeof text !== 'string') return null
  const backlinks = ix?.backlinks(path) ?? []
  const onReadClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.wikilink') as HTMLElement | null
    if (!a) return
    e.preventDefault()
    if (a.dataset.path) openFile(a.dataset.path, a.dataset.heading || null)
  }
  const crumbs = path.split('/').slice(0, -1)

  return (
    <div className="note-pane">
      <div className="note-head">
        <div className="note-crumbs">{crumbs.join(' / ') || 'Vault'}</div>
        <div className="note-tools">
          <div className="seg">
            {(['read', 'edit', 'source'] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => (flush(), setMode(m))} title={m === 'edit' ? 'Live preview: formatting shows as you write' : m === 'source' ? 'Plain markdown source' : 'Reading view'}>
                <span>{m === 'read' ? 'Read' : m === 'edit' ? 'Edit' : 'Source'}</span>
              </button>
            ))}
          </div>
          <button
            className="chip-btn"
            onClick={() => vault && window.atlas.openExternal(`obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(path.replace(/\.md$/, ''))}`)}
          >
            Open in Obsidian
          </button>
        </div>
      </div>
      <div className="note-scroll">
        <div className="note-col">
          <h1 className="note-title">{noteName(path)}</h1>
          <Properties path={path} text={text} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {mode === 'read' ? (
                <div ref={readRef} className="prose note-prose" onClick={onReadClick} dangerouslySetInnerHTML={{ __html: html || '<p class="muted">Empty note.</p>' }} />
              ) : (
                <>
                  <Toolbar view={view} />
                  <Editor
                    docKey={path}
                    value={editorValue}
                    eol={parts.eol}
                    getIndex={() => useStore.getState().index}
                    onChange={onBodyChange}
                    onView={(v) => (view.current = v)}
                    live={mode === 'edit' ? livePreviewHooks(path) : undefined}
                  />
                </>
              )}
            </motion.div>
          </AnimatePresence>
          {backlinks.length > 0 && (
            <div className="backlinks">
              <h4>Linked from</h4>
              {backlinks.map((b) => (
                <button key={b} className="backlink" onClick={() => openFile(b)}>
                  <span>{noteName(b)}</span>
                  <span className="muted">{b.split('/').slice(0, -1).join(' / ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function livePreviewHooks(from: string) {
  return {
    openLink: (target: string, heading?: string) => {
      const st = useStore.getState()
      const p = st.index?.resolver.resolve(target, from) ?? (target === '' ? from : null)
      if (p) st.openFile(p, heading ?? null)
    },
    imageUrl: (target: string) => {
      const p = useStore.getState().index?.resolver.resolve(target, from)
      return p && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p) ? vaultUrl(p) : null
    }
  }
}

function Toolbar({ view }: { view: React.MutableRefObject<EditorView | null> }) {
  const B: [string, string, (v: EditorView) => void][] = [
    ['H', 'Heading', (v) => linePrefix(v, '## ')],
    ['B', 'Bold (⌘B)', (v) => wrap(v, '**')],
    ['I', 'Italic (⌘I)', (v) => wrap(v, '*')],
    ['S', 'Strikethrough (⌘⇧X)', (v) => wrap(v, '~~')],
    ['•', 'List', (v) => linePrefix(v, '- ')],
    ['☐', 'Checkbox', (v) => linePrefix(v, '- [ ] ')],
    ['❝', 'Quote', (v) => linePrefix(v, '> ')],
    ['<>', 'Code (⌘E)', (v) => wrap(v, '`')],
    ['[[ ]]', 'Wikilink (⌘L)', (v) => wrap(v, '[[', ']]')]
  ]
  return (
    <div className="md-toolbar">
      {B.map(([label, title, fn]) => (
        <button key={title} title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => view.current && fn(view.current)} className={`tb-${label === 'B' ? 'b' : label === 'I' ? 'i' : label === 'S' ? 's' : 'x'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** Frontmatter properties, edited in place (one key's text patched per edit). */
function Properties({ path, text }: { path: string; text: string }) {
  const writeFile = useStore((s) => s.writeFile)
  const ix = useStore((s) => s.index)
  const fm = ix?.notes.get(path)?.fm
  const [adding, setAdding] = useState(false)
  if (!fm) return null
  if (fm.errors.length) return <div className="props-panel error">Frontmatter has a YAML error on line {fm.errors[0].line}: edit it in Obsidian or the source.</div>
  const entries = Object.entries(fm.data)
  const set = (key: string, value: unknown) => {
    const next = patchFrontmatter(text, key, value)
    if (next === text) return
    // re-dating an event moves its sub-events that follow it (contract 4, Linked events)
    if (['year', 'day', 'hour', 'minute'].includes(key) && ix?.beat(path)) void redateEvent(path, next)
    else writeFile(path, next)
  }
  const parse = (raw: string, prev: unknown): unknown => {
    if (Array.isArray(prev)) return raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (typeof prev === 'number' && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
    if (typeof prev === 'boolean') return raw.trim() === 'true'
    return raw
  }
  const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  if (!entries.length && !adding)
    return (
      <div className="props-panel empty">
        <button className="add-prop" onClick={() => setAdding(true)}>
          + Add property
        </button>
      </div>
    )
  return (
    <div className="props-panel">
      {entries.map(([k, v]) => (
        <div className="prop-row" key={k}>
          <span className="prop-key">{k}</span>
          {typeof v === 'object' && v !== null && !Array.isArray(v) ? (
            <span className="prop-val muted">{show(v)}</span>
          ) : (
            <input
              className="prop-val"
              key={show(v)}
              defaultValue={show(v)}
              onBlur={(e) => e.currentTarget.value !== show(v) && set(k, parse(e.currentTarget.value, v))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          )}
          <button className="prop-del" title="Remove property" onClick={() => set(k, undefined)}>
            ×
          </button>
        </div>
      ))}
      {adding ? (
        <form
          className="prop-row"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const k = String(f.get('k') ?? '').trim()
            if (k && /^[A-Za-z_][\w-]*$/.test(k)) set(k, String(f.get('v') ?? ''))
            setAdding(false)
          }}
        >
          <input name="k" className="prop-key-input" placeholder="key" autoFocus />
          <input name="v" className="prop-val" placeholder="value" onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <button className="prop-del" type="submit" title="Add">
            ↵
          </button>
        </form>
      ) : (
        <button className="add-prop" onClick={() => setAdding(true)}>
          + Add property
        </button>
      )}
    </div>
  )
}
