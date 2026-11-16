// Add a character: tag an existing note, create a new note, or make an Atlas/Entities stub for a heading.
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { patchFrontmatter } from '@core/note'
import { fuzzyScore } from '@core/fuzzy'
import { PATHS } from '@core/config'
import { yamlValue } from '@core/note'
import { useStore, noteName } from '../store'

type Mode = 'tag' | 'new' | 'heading'

export function AddCharacter({ onClose }: { onClose(): void }) {
  const ix = useStore((s) => s.index)!
  const st = useStore.getState
  const [mode, setMode] = useState<Mode>('tag')
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('Characters')
  const [err, setErr] = useState<string | null>(null)

  const notes = useMemo(() => {
    const cands = [...ix.notes.values()].filter((n) => n.fm.data.type === undefined && !n.path.startsWith(PATHS.timeline + '/') && !n.path.startsWith('Atlas/') && !n.path.startsWith('Templates/'))
    return cands
      .map((n) => ({ n, s: q ? fuzzyScore(q, n.name) : 0 }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (b.s as number) - (a.s as number) || a.n.name.localeCompare(b.n.name))
      .slice(0, 40)
      .map((x) => x.n)
  }, [ix, q])
  const headings = useMemo(() => {
    const out: { path: string; text: string; level: number }[] = []
    for (const n of ix.notes.values()) {
      if (n.path.startsWith('Atlas/')) continue
      for (const h of n.headings) if (!q || fuzzyScore(q, `${h.text} ${n.name}`) !== null) out.push({ path: n.path, text: h.text, level: h.level })
    }
    return out.slice(0, 60)
  }, [ix, q])

  const done = (id: string) => {
    onClose()
    setTimeout(() => st().openCharacter(id), 120)
  }
  const tag = async (path: string) => {
    const cur = st().files.get(path)
    if (typeof cur !== 'string') return
    await st().writeFile(path, patchFrontmatter(cur, 'type', 'character'))
    done(path)
  }
  const create = async () => {
    const n = name.trim()
    if (!n || /[\\/:*?"<>|#^\[\]]/.test(n)) return setErr('Use a plain name (no / : # [ ] characters).')
    const path = `${folder.trim().replace(/^\/|\/$/g, '') ? folder.trim().replace(/^\/|\/$/g, '') + '/' : ''}${n}.md`
    try {
      await window.atlas.create(path, `---\ntype: character\n---\n`)
      st().applyChanges([[path, `---\ntype: character\n---\n`]])
      done(path)
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const stub = async (path: string, heading: string) => {
    const file = `${PATHS.entities}/${heading.replace(/[\\/:*?"<>|#^\[\]]/g, ' ').trim()}.md`
    const text = `---\ntype: character\nsource: ${yamlValue(`[[${noteName(path)}#${heading}]]`)}\n---\n`
    try {
      await window.atlas.create(file, text)
      st().applyChanges([[file, text]])
      done(file)
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <motion.div className="palette-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="palette add-char" initial={{ opacity: 0, y: -10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="add-head">
          <div className="tl-title">Add a character</div>
          <div className="seg">
            {([['tag', 'Tag a note'], ['heading', 'From a heading'], ['new', 'New note']] as [Mode, string][]).map(([m, l]) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => (setMode(m), setErr(null))}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {mode !== 'new' ? (
          <>
            <input className="palette-input" autoFocus placeholder={mode === 'tag' ? 'Find the note…' : 'Find the heading (e.g. Chara)…'} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
            <div className="palette-list">
              {mode === 'tag'
                ? notes.map((n) => (
                    <button key={n.path} className="palette-item" onClick={() => tag(n.path)} data-path={n.path}>
                      <span className="pi-label">{n.name}</span>
                      <span className="pi-detail">{n.path.split('/').slice(0, -1).join(' / ')} · adds type: character</span>
                    </button>
                  ))
                : headings.map((h) => (
                    <button key={h.path + h.text} className="palette-item" onClick={() => stub(h.path, h.text)} data-heading={h.text}>
                      <span className="pi-label">{h.text}</span>
                      <span className="pi-detail">
                        in {noteName(h.path)} · creates {PATHS.entities}/{h.text}.md
                      </span>
                    </button>
                  ))}
            </div>
          </>
        ) : (
          <form className="add-new" onSubmit={(e) => (e.preventDefault(), create())}>
            <label>
              Name
              <input className="field-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Folder
              <input className="field-input" value={folder} onChange={(e) => setFolder(e.target.value)} />
            </label>
            <button className="chip-btn primary" type="submit">
              Create note
            </button>
          </form>
        )}
        {err && <div className="add-err">{err}</div>}
      </motion.div>
    </motion.div>
  )
}
