// File tree: folders and files, create / rename / move by drag / delete to trash.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { useStore } from '../store'
import { IconFolder } from '../components/Icons'
import { moveVaultPath } from './move'

interface Node {
  name: string
  path: string
  dir: boolean
  children: Node[]
}

function buildTree(files: Iterable<string>, dirs: Iterable<string>): Node {
  const root: Node = { name: '', path: '', dir: true, children: [] }
  const byPath = new Map<string, Node>([['', root]])
  const ensureDir = (p: string): Node => {
    const hit = byPath.get(p)
    if (hit) return hit
    const parent = ensureDir(p.split('/').slice(0, -1).join('/'))
    const n: Node = { name: p.split('/').pop()!, path: p, dir: true, children: [] }
    parent.children.push(n)
    byPath.set(p, n)
    return n
  }
  for (const d of dirs) ensureDir(d)
  for (const f of files) {
    const parent = ensureDir(f.split('/').slice(0, -1).join('/'))
    parent.children.push({ name: f.split('/').pop()!, path: f, dir: false, children: [] })
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

const parentDir = (p: string) => p.split('/').slice(0, -1).join('/')
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

export async function uniquePath(dir: string, base: string, ext: string) {
  const files = useStore.getState().files
  const dirs = useStore.getState().dirs
  for (let i = 1; ; i++) {
    const p = join(dir, `${base}${i > 1 ? ' ' + i : ''}${ext}`)
    if (!files.has(p) && !dirs.has(p)) return p
  }
}

interface Menu { x: number; y: number; node: Node }

export function Tree() {
  const files = useStore((s) => s.files)
  const dirs = useStore((s) => s.dirs)
  const openNote = useStore((s) => s.openNote)
  const openFile = useStore((s) => s.openFile)
  const tree = useMemo(() => buildTree([...files.keys()], dirs), [files, dirs])
  const [open, setOpen] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('atlas.tree.open') ?? '[]')))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => localStorage.setItem('atlas.tree.open', JSON.stringify([...open])), [open])
  // reveal the open note
  useEffect(() => {
    if (!openNote) return
    const parts = openNote.split('/').slice(0, -1)
    setOpen((o) => {
      const n = new Set(o)
      parts.forEach((_, i) => n.add(parts.slice(0, i + 1).join('/')))
      return n.size === o.size ? o : n
    })
  }, [openNote])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  const toggle = (p: string) => setOpen((o) => (o.has(p) ? (o.delete(p), new Set(o)) : new Set(o).add(p)))
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e: any) {
      setError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const newNote = (dir: string) =>
    run(async () => {
      const p = await uniquePath(dir, 'Untitled', '.md')
      await window.atlas.create(p, '')
      useStore.getState().applyChanges([[p, '']])
      if (dir) setOpen((o) => new Set(o).add(dir))
      openFile(p)
      setRenaming(p)
    })
  const newFolder = (dir: string) =>
    run(async () => {
      const p = await uniquePath(dir, 'New folder', '')
      await window.atlas.mkdir(p)
      useStore.getState().setDirs([...useStore.getState().dirs, p])
      if (dir) setOpen((o) => new Set(o).add(dir))
      setRenaming(p)
    })
  const move = (from: string, to: string) =>
    run(async () => {
      await moveVaultPath(from, to)
    })
  const commitRename = (node: Node, name: string) => {
    setRenaming(null)
    name = name.trim()
    if (!name || name === node.name.replace(/\.md$/i, '') || name.includes('/')) return
    const ext = !node.dir && node.name.toLowerCase().endsWith('.md') && !name.toLowerCase().endsWith('.md') ? '.md' : ''
    move(node.path, join(parentDir(node.path), name + ext))
  }
  const remove = (node: Node) =>
    run(async () => {
      const label = node.dir ? `the folder “${node.name}” and everything in it` : `“${node.name.replace(/\.md$/, '')}”`
      if (!window.confirm(`Move ${label} to the system trash?`)) return
      await window.atlas.trash(node.path)
      const st = useStore.getState()
      st.applyChanges([[node.path, false]])
      st.setDirs([...st.dirs].filter((d) => d !== node.path && !d.startsWith(node.path + '/')))
    })

  const onDrop = (e: DragEvent, dir: string) => {
    e.preventDefault()
    setDropTarget(null)
    const from = e.dataTransfer.getData('text/atlas-path')
    if (!from || from === dir || dir.startsWith(from + '/') || parentDir(from) === dir) return
    move(from, join(dir, from.split('/').pop()!))
  }

  const renderNode = (n: Node, depth: number) => {
    const isOpen = open.has(n.path)
    const active = openNote === n.path
    const label = n.dir ? n.name : n.name.replace(/\.md$/i, '')
    const isMd = n.name.toLowerCase().endsWith('.md')
    return (
      <div key={n.path}>
        <div
          className={`tree-row${active ? ' active' : ''}${dropTarget === n.path ? ' drop' : ''}${!n.dir && !isMd ? ' dim' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          draggable={renaming !== n.path}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/atlas-path', n.path)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (!n.dir) return
            e.preventDefault()
            setDropTarget(n.path)
          }}
          onDragLeave={() => setDropTarget((d) => (d === n.path ? null : d))}
          onDrop={(e) => n.dir && onDrop(e, n.path)}
          onClick={() => (n.dir ? toggle(n.path) : isMd ? openFile(n.path) : null)}
          onDoubleClick={() => setRenaming(n.path)}
          onContextMenu={(e: MouseEvent) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, node: n })
          }}
          data-path={n.path}
        >
          {n.dir ? (
            <motion.span className="tree-caret" animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.16 }}>
              ›
            </motion.span>
          ) : (
            <span className="tree-caret" />
          )}
          {n.dir && <IconFolder className="tree-icon" />}
          {renaming === n.path ? (
            <input
              className="tree-input"
              autoFocus
              defaultValue={label}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(n, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tree-label">{label}</span>
          )}
        </div>
        <AnimatePresence initial={false}>
          {n.dir && isOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }}>
              {n.children.map((c) => renderNode(c, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="tree" onClick={() => setMenu(null)}>
      <div className="tree-head">
        <span>Vault</span>
        <span className="tree-actions">
          <button className="icon-btn" title="New note" onClick={() => newNote('')}>
            ＋
          </button>
          <button className="icon-btn" title="New folder" onClick={() => newFolder('')}>
            <IconFolder />
          </button>
        </span>
      </div>
      <div
        className={`tree-body${dropTarget === '' ? ' drop' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.target === e.currentTarget) setDropTarget('')
        }}
        onDrop={(e) => onDrop(e, '')}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: tree })
        }}
      >
        {tree.children.map((c) => renderNode(c, 0))}
      </div>
      <AnimatePresence>
        {menu && (
          <motion.div className="ctx-menu" style={{ left: menu.x, top: menu.y }} initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
            {([
              ...(menu.node.dir ? [['New note', () => newNote(menu.node.path)], ['New folder', () => newFolder(menu.node.path)]] : []),
              ...(menu.node.path ? [['Rename', () => setRenaming(menu.node.path)], ['Move to trash', () => remove(menu.node)]] : [])
            ] as [string, () => unknown][]).map(([label, fn]) => (
              <button key={label} onClick={() => (setMenu(null), fn())}>
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{error && <motion.div className="toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}</motion.div>}</AnimatePresence>
    </div>
  )
}
