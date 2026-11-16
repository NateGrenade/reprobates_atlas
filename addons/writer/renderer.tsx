import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { type Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import { diffWords } from 'diff'
import MarkdownIt from 'markdown-it'
import type { AddonApi } from '../../src/renderer/src/addons/host'
import { DEFAULT_SETTINGS, type WriterBook, type WriterBridge, type WriterDocument, type WriterSettings, type WriterSnapshot } from './types'
import { bindSource, parseManuscript, plainText, serializeManuscript, wordCount, type SourceDocument } from './markdown'
import { SourceAttributes, WriterComment, WriterSuggestion, WriterWiki, WriterFootnote, WriterPageBreak, Search, searchKey, writerBehavior, inlineTracking, indent, selectQuote } from './extensions'
import css from './style.css'

type Review = { type: string; pos: number; size: number; text: string; before?: string; after?: string }
type Heading = { title: string; pos: number; level: number; words: number; end: number }
type Dialog = 'create' | 'import' | 'link' | 'footnote' | 'comment' | 'suggest' | null
const referenceMd = new MarkdownIt({ html: false, breaks: true })
const titleOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(error)

export default function activate(api: AddonApi) {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style)
  const documents = new Map<string, { original: string; content: string; pending?: Promise<void>; error?: string }>()
  let rememberedPath = localStorage.getItem('writer.path') || ''
  let draftingAllowed = false
  const persist = async (path: string) => {
    const draft = documents.get(path)
    if (!draft || draft.content === draft.original) return
    if (draft.pending) { await draft.pending; if (draft.content !== draft.original) return persist(path); return }
    const content = draft.content
    draft.pending = api.ipc.invoke('save', { path, content, original: draft.original }).then(() => { draft.original = content; draft.error = undefined }, (e: unknown) => { draft.error = errorText(e); throw e }).finally(() => { draft.pending = undefined })
    await draft.pending
  }

  function Writer() {
    const vault = api.store(s => s.vault)
    const index = api.store(s => s.index)
    const [books, setBooks] = useState<WriterBook[]>([])
    const [doc, setDoc] = useState<WriterDocument | null>(null)
    const [settings, setSettings] = useState<WriterSettings>(DEFAULT_SETTINGS)
    const settingsRef = useRef(settings); settingsRef.current = settings
    const [editor, setEditor] = useState<Editor | null>(null)
    const [tick, setTick] = useState(0)
    const [status, setStatus] = useState('Saved')
    const [error, setError] = useState('')
    const [focus, setFocus] = useState(false)
    const [typewriter, setTypewriter] = useState(false)
    const [typing, setTyping] = useState(false)
    const [tracking, setTracking] = useState(false)
    const trackingRef = useRef(tracking); trackingRef.current = tracking
    const [showSetup, setShowSetup] = useState(false)
    const [panel, setPanel] = useState<'lore' | 'review' | 'snapshots' | null>('lore')
    const [dialog, setDialog] = useState<Dialog>(null)
    const [fields, setFields] = useState<Record<string, string>>({})
    const [findOpen, setFindOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [replacement, setReplacement] = useState('')
    const [snapshots, setSnapshots] = useState<WriterSnapshot[]>([])
    const [comparison, setComparison] = useState<{ snapshot: WriterSnapshot; content: string } | null>(null)
    const [split, setSplit] = useState<{ path: string; content: string } | null>(null)
    const [splitPicker, setSplitPicker] = useState(false)
    const [loreQuery, setLoreQuery] = useState('')
    const [selectedLore, setSelectedLore] = useState<string | null>(null)
    const [hover, setHover] = useState<{ name: string; content: string; x: number; y: number } | null>(null)
    const [canDraft, setCanDraft] = useState(draftingAllowed)
    const [sessionWords, setSessionWords] = useState(0)
    const dayKey = `writer.day.${new Date().toLocaleDateString('en-CA')}`
    const [dailyWords, setDailyWords] = useState(Number(localStorage.getItem(dayKey) || 0))
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const activePath = useRef('')
    const stage = useRef<HTMLDivElement>(null)
    const openCounter = useRef(0)
    const lastWords = useRef(0)
    const selectionRange = useRef({ from: 1, to: 1 })
    const refresh = useCallback(async () => { const list = await api.ipc.invoke('list'); setBooks(list.books) }, [])
    const open = useCallback(async (path: string) => {
      const turn = ++openCounter.current
      setError('')
      try {
        if (activePath.current && activePath.current !== path) await persist(activePath.current)
        const loaded: WriterDocument = documents.has(path) ? { path, content: documents.get(path)!.content } : await api.ipc.invoke('read', path)
        const setup = await api.ipc.invoke('settings:get', path)
        if (turn !== openCounter.current) return
        if (!documents.has(path)) documents.set(path, { original: loaded.content, content: loaded.content })
        activePath.current = path; rememberedPath = path; localStorage.setItem('writer.path', path)
        lastWords.current = wordCount(loaded.content)
        setSettings({ ...DEFAULT_SETTINGS, ...setup }); setDoc(loaded); setStatus('Saved'); setComparison(null)
      } catch (e) { setError(errorText(e)) }
    }, [])
    useEffect(() => {
      if (!vault) { setDoc(null); return }
      refresh().then(() => { if (rememberedPath) void open(rememberedPath) }).catch(e => setError(errorText(e)))
    }, [vault?.root])
    useEffect(() => () => { clearTimeout(saveTimer.current); clearTimeout(typingTimer.current); if (activePath.current) void persist(activePath.current).catch(e => api.toast(`Write could not save: ${errorText(e)}`)) }, [])
    const save = async () => {
      if (!activePath.current) return
      clearTimeout(saveTimer.current); setStatus('Saving…')
      try { await persist(activePath.current); setStatus('Saved'); setError(''); await refresh() } catch (e) { setStatus('Unsaved'); setError(errorText(e)) }
    }
    const changed = useCallback((content: string, currentEditor: Editor) => {
      const path = activePath.current, draft = documents.get(path)
      if (!draft) return
      draft.content = content; setTick(t => t + 1); setStatus('Unsaved')
      const count = wordCount(plainText(currentEditor.getJSON())), delta = count - lastWords.current; lastWords.current = count
      if (delta) {
        setSessionWords(n => Math.max(0, n + delta))
        setDailyWords(n => { const next = Math.max(0, n + delta); localStorage.setItem(dayKey, String(next)); return next })
      }
      setTyping(true); clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(false), 1300)
      clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => void save(), 950)
    }, [dayKey])
    const changeSettings = (patch: Partial<WriterSettings>) => {
      const next = { ...settingsRef.current, ...patch }; setSettings(next)
      if (activePath.current) void api.ipc.invoke('settings:save', { path: activePath.current, settings: next }).catch(e => setError(errorText(e)))
    }
    const currentContent = () => doc ? documents.get(doc.path)?.content || '' : ''
    const reloadContent = (content: string) => {
      if (!doc || !editor) return
      const parsed = parseManuscript(content)
      editor.commands.setContent(parsed.html, { emitUpdate: false })
      bindSource(editor.getJSON(), parsed.source)
      ;(editor.storage as any).writerSource = parsed.source
      changed(content, editor)
    }
    const reloadDisk = async () => {
      if (!doc || !editor) return
      await api.ipc.invoke('snapshots:create', { path: doc.path, content: currentContent() })
      const loaded: WriterDocument = await api.ipc.invoke('read', doc.path)
      documents.set(doc.path, { original: loaded.content, content: loaded.content })
      const parsed = parseManuscript(loaded.content)
      editor.commands.setContent(parsed.html, { emitUpdate: false }); bindSource(editor.getJSON(), parsed.source)
      ;(editor.storage as any).writerSource = parsed.source
      lastWords.current = wordCount(plainText(editor.getJSON()))
      setDoc(loaded); setTick(t => t + 1); setError(''); setStatus('Saved')
      api.toast('Reloaded disk version. Your previous draft is saved as a snapshot.')
    }
    const selectionText = () => editor?.state.doc.textBetween(selectionRange.current.from, selectionRange.current.to, '\n') || ''
    const beginDialog = (kind: Dialog) => {
      if (editor) selectionRange.current = { from: editor.state.selection.from, to: editor.state.selection.to }
      setFields({ book: doc?.path.split('/')[1] || books[0]?.name || 'Book One', title: '', quote: selectionText() }); setDialog(kind)
    }
    const reviews: Review[] = []
    const headings: Heading[] = []
    if (editor) {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'writerComment') reviews.push({ type: 'comment', pos, size: node.nodeSize, text: node.attrs.text })
        if (node.type.name === 'writerSuggestion') reviews.push({ type: 'suggestion', pos, size: node.nodeSize, text: '', before: node.attrs.before, after: node.attrs.after })
        if (node.type.name === 'heading') headings.push({ title: node.textContent || 'Untitled', pos, level: node.attrs.level, words: 0, end: 0 })
      })
      headings.forEach((h, i) => { h.end = headings.slice(i + 1).find(n => n.level <= h.level)?.pos ?? editor.state.doc.content.size; h.words = wordCount(plainText({ type: 'doc', content: editor.state.doc.slice(h.pos, h.end).content.toJSON() })) })
    }
    const cursor = editor?.state.selection.from || 0
    const scene = headings.filter(h => h.level >= 3 && h.pos <= cursor).at(-1)
    const sceneText = editor ? plainText({ type: 'doc', content: editor.state.doc.slice(scene?.pos || 0, scene?.end || editor.state.doc.content.size).content.toJSON() }) : ''
    const contentText = editor ? plainText(editor.getJSON()) : ''
    const words = wordCount(contentText)
    const book = books.find(b => b.name === doc?.path.split('/')[1])
    const bookWords = (book?.chapters || []).reduce((n, c) => n + (c.path === doc?.path ? words : c.words), 0)
    const lore = useMemo(() => Array.from(index?.entities.values() || []).map(e => ({ id: e.id, name: e.name, type: e.type, content: index?.loreOf(e.id) || '' })).filter(e => !e.id.startsWith('Manuscript/')), [index])
    const mentioned = lore.filter(e => e.name.length > 2 && sceneText.toLocaleLowerCase().includes(e.name.toLocaleLowerCase()))
    const resolveLore = (target: string) => lore.find(e => e.name.toLocaleLowerCase() === target.replace(/\.md$/, '').toLocaleLowerCase() || e.id.replace(/\.md$/, '').endsWith(target.replace(/\.md$/, '')))
    const inspect = (target: string) => { const entity = resolveLore(target); if (entity) { api.store.getState().select(entity.id); setSelectedLore(entity.id); setPanel('lore') } else api.toast(`No lore note found for ${target}`) }
    const showHover = (target: string, element: HTMLElement) => {
      const note = resolveLore(target), rect = element.getBoundingClientRect()
      if (note) setHover({ name: note.name, content: note.content.slice(0, 450).replace(/^---[^]*?---\s*/, ''), x: Math.min(rect.left, window.innerWidth - 310), y: Math.min(rect.bottom + 8, window.innerHeight - 220) })
    }
    useEffect(() => {
      if (!editor || !doc) return
      const bridge: WriterBridge = {
        read: () => {
          const items: WriterBridge extends never ? never : any[] = []
          editor.state.doc.descendants(node => { if (node.type.name === 'writerComment') items.push({ type: 'comment', text: node.attrs.text }); if (node.type.name === 'writerSuggestion') items.push({ type: 'suggestion', text: '', before: node.attrs.before, after: node.attrs.after }) })
          return { path: doc.path, title: titleOf(doc.path), content: documents.get(doc.path)!.content, selection: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n'), comments: items, canDraft: draftingAllowed }
        },
        comment: async ({ quote, text }) => { const range = selectQuote(editor, quote); editor.chain().focus().insertContentAt(range.to, { type: 'writerComment', attrs: { text } }).run(); await persist(doc.path); return { ok: true } },
        suggest: async ({ quote, replacement, reason }) => { const range = selectQuote(editor, quote); editor.chain().focus().insertContentAt(range, [{ type: 'writerSuggestion', attrs: { before: quote, after: replacement } }, ...(reason ? [{ type: 'writerComment', attrs: { text: reason } }] : [])]).run(); await persist(doc.path); return { ok: true } },
        replace: async ({ content }) => { if (!draftingAllowed) throw new Error('Enable assistant drafting for this session in Write first.'); reloadContent(content); await persist(doc.path); return { ok: true } },
      }
      ;(window as any).__atlasWriter = bridge
      return () => { if ((window as any).__atlasWriter === bridge) delete (window as any).__atlasWriter }
    }, [editor, doc?.path])
    useEffect(() => {
      const keydown = (e: KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey)) return
        if (e.key.toLowerCase() === 's') { e.preventDefault(); void save() }
        if (e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true) }
      }
      window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown)
    }, [doc, editor])
    useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta(searchKey, query)) }, [editor, query])
    useEffect(() => { if (panel === 'snapshots' && doc) api.ipc.invoke('snapshots:list', doc.path).then(setSnapshots).catch(e => setError(errorText(e))) }, [panel, doc?.path])
    const jump = (pos: number) => { editor?.chain().focus().setTextSelection(pos + 1).scrollIntoView().run() }
    const accept = (r: Review, yes: boolean) => {
      if (!editor) return
      const text = (yes ? r.after : r.before) || ''
      const range = { from: r.pos, to: r.pos + r.size }
      if (text) editor.chain().focus().insertContentAt(range, { type: 'text', text }).run()
      else editor.chain().focus().deleteRange(range).run()
    }
    const addWiki = (entity: { name: string }) => { editor?.chain().focus().insertContent({ type: 'writerWiki', attrs: { target: entity.name, label: '' } }).run() }
    const linkMention = (name: string) => { if (!editor) return; const range = selectQuote(editor, name); editor.chain().focus().insertContentAt(range, { type: 'writerWiki', attrs: { target: name, label: '' } }).run() }
    const searchMove = (direction: number) => {
      if (!editor) return
      const matches = searchKey.getState(editor.state)?.matches || [], pos = editor.state.selection.from
      const match = direction > 0 ? matches.find(m => m.from > pos) || matches[0] : [...matches].reverse().find(m => m.from < pos) || matches.at(-1)
      if (match) editor.chain().focus().setTextSelection(match).scrollIntoView().run()
    }
    const replace = (all: boolean) => {
      if (!editor || !query) return
      const matches = searchKey.getState(editor.state)?.matches || []
      const current = matches.find(m => m.from === editor.state.selection.from) || matches.find(m => m.from >= editor.state.selection.from) || matches[0]
      const tr = editor.state.tr
      for (const match of (all ? [...matches].reverse() : current ? [current] : [])) tr.insertText(replacement, match.from, match.to)
      editor.view.dispatch(tr)
    }
    const snapshot = async () => {
      if (!doc) return
      await api.ipc.invoke('snapshots:create', { path: doc.path, content: currentContent() }); setSnapshots(await api.ipc.invoke('snapshots:list', doc.path)); api.toast('Snapshot saved')
    }
    const submitDialog = async () => {
      if (!dialog) return
      setError('')
      try {
        if (dialog === 'create' || dialog === 'import') {
          if (!fields.book?.trim() || dialog === 'create' && !fields.title?.trim()) throw new Error('Enter a book and chapter title.')
          const created = await api.ipc.invoke(dialog, { book: fields.book.trim(), title: fields.title?.trim() }); if (created) { await refresh(); await open(created.path) }
        } else if (editor) {
          const range = selectionRange.current
          if (dialog === 'link') { const url = fields.url?.trim(); if (!url || !/^(https?:|mailto:|#)/i.test(url)) throw new Error('Enter a web address, email link, or #anchor.'); editor.chain().focus().setTextSelection(range).setLink({ href: url }).run() }
          if (dialog === 'comment') { if (!fields.text?.trim()) throw new Error('Enter a comment.'); editor.chain().focus().insertContentAt(range.to, { type: 'writerComment', attrs: { text: fields.text } }).run(); setPanel('review') }
          if (dialog === 'suggest') { const quote = editor.state.doc.textBetween(range.from, range.to, '\n'); editor.chain().focus().insertContentAt(range, { type: 'writerSuggestion', attrs: { before: quote, after: fields.text || '' } }).run(); setPanel('review') }
          if (dialog === 'footnote') {
            if (!fields.text?.trim()) throw new Error('Enter footnote text.')
            let count = 1; editor.state.doc.descendants(n => { if (n.type.name === 'writerFootnote') count++ })
            editor.chain().focus().insertContentAt(range.to, { type: 'writerFootnote', attrs: { id: String(count) } }).run()
            editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: `[^${count}]: ${fields.text}` }] })
          }
        }
        setDialog(null)
      } catch (e) { setError(errorText(e)) }
    }
    const changeBlock = (value: string) => {
      if (!editor) return
      const chain = editor.chain().focus()
      if (value === 'quote') chain.setBlockquote().run()
      else if (['title', 'chapter', 'scene'].includes(value)) { if (editor.isActive('blockquote')) chain.unsetBlockquote(); chain.setHeading({ level: ({ title: 1, chapter: 2, scene: 3 } as any)[value] }).updateAttributes('heading', { writerStyle: value }).run() }
      else { if (editor.isActive('blockquote')) chain.unsetBlockquote(); chain.setParagraph().updateAttributes('paragraph', { writerStyle: value === 'note' ? 'note' : null }).run() }
    }
    const activeStyle = editor?.isActive('blockquote') ? 'quote' : editor?.isActive('heading') ? ({ 1: 'title', 2: 'chapter', 3: 'scene' } as any)[editor.getAttributes('heading').level] || 'scene' : editor?.getAttributes('paragraph').writerStyle === 'note' ? 'note' : 'body'
    const reorderChapter = async (from: string, to: string) => {
      const sourceBook = books.find(b => b.chapters.some(c => c.path === from))
      if (!sourceBook || !sourceBook.chapters.some(c => c.path === to)) return
      const paths = sourceBook.chapters.map(c => c.path), at = paths.indexOf(to); paths.splice(paths.indexOf(from), 1); paths.splice(at, 0, from)
      await api.ipc.invoke('reorder', { book: sourceBook.name, paths }); await refresh()
    }
    const reorderScene = (from: number, to: number) => {
      if (!editor || from === to) return
      const heading = headings.find(h => h.pos === from)
      if (!heading || to > from && to < heading.end) return
      const content = editor.state.doc.slice(from, heading.end).content
      const tr = editor.state.tr.delete(from, heading.end); const destination = to > from ? to - (heading.end - from) : to
      tr.insert(destination, content); editor.view.dispatch(tr)
    }
    const toolbarButton = (label: string, content: ReactNode, action: () => void, active = false, disabled = false) => <button key={label} title={label} aria-label={label} aria-pressed={active} className={active ? 'active' : ''} disabled={disabled || !editor} onMouseDown={e => e.preventDefault()} onClick={action}>{content}</button>
    return <div className={`writer ${focus ? 'writer-focus' : ''} ${typing ? 'writer-typing' : ''}`}>
      <header className="writer-header">
        <div className="writer-brand"><span className="writer-feather">⌁</span><span>Write</span><small>MANUSCRIPT DESK</small></div>
        <div className="writer-document-title">{doc ? <><span>{doc.path.split('/')[1]}</span><b>/</b>{titleOf(doc.path)}</> : 'A place for the story'}</div>
        <div className="writer-header-actions">
          <button title="Find and replace (⌘F)" aria-label="Find and replace" className={findOpen ? 'active' : ''} onClick={() => setFindOpen(!findOpen)}>⌕</button>
          <button title="Reference beside manuscript" className={splitPicker || split ? 'active' : ''} onClick={() => split ? setSplit(null) : setSplitPicker(!splitPicker)}>◫</button>
          <button title="Focus mode" aria-label="Focus mode" className={focus ? 'active' : ''} onClick={() => setFocus(!focus)}>◩</button>
          <button title="Document settings" aria-label="Document settings" className={showSetup ? 'active' : ''} onClick={() => setShowSetup(!showSetup)}>Aa</button>
          <button className="writer-primary" onClick={() => beginDialog('create')}>New chapter</button>
        </div>
      </header>
      <div className="writer-toolbar" role="toolbar" aria-label="Manuscript formatting">
        <select aria-label="Paragraph style" disabled={!editor} value={activeStyle} onChange={e => changeBlock(e.target.value)}>{['title', 'chapter', 'scene', 'body', 'quote', 'note'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select><i />
        {toolbarButton('Bold (⌘B)', <b>B</b>, () => editor!.chain().focus().toggleBold().run(), editor?.isActive('bold'))}
        {toolbarButton('Italic (⌘I)', <em>I</em>, () => editor!.chain().focus().toggleItalic().run(), editor?.isActive('italic'))}
        {toolbarButton('Underline (⌘U)', <u>U</u>, () => editor!.chain().focus().toggleUnderline().run(), editor?.isActive('underline'))}
        {toolbarButton('Strikethrough', <s>S</s>, () => editor!.chain().focus().toggleStrike().run(), editor?.isActive('strike'))}<i />
        {(['left', 'center', 'right', 'justify'] as const).map((a, i) => toolbarButton(`Align ${a}`, ['≡', '☰', '≡', '▤'][i], () => editor!.chain().focus().setTextAlign(a).run(), editor?.isActive({ textAlign: a })))}<i />
        {toolbarButton('Bullet list', '• ≡', () => editor!.chain().focus().toggleBulletList().run(), editor?.isActive('bulletList'))}
        {toolbarButton('Numbered list', '1 ≡', () => editor!.chain().focus().toggleOrderedList().run(), editor?.isActive('orderedList'))}
        {toolbarButton('Decrease indent', '⇤', () => indent(editor!, -1))}{toolbarButton('Increase indent', '⇥', () => indent(editor!, 1))}<i />
        {toolbarButton('Scene break', '⁂', () => editor!.chain().focus().setHorizontalRule().run())}
        {toolbarButton('Page break', '▱', () => editor!.chain().focus().insertContent({ type: 'writerPageBreak' }).run())}
        {toolbarButton('Insert link', '↗', () => beginDialog('link'), editor?.isActive('link'))}
        {toolbarButton('Insert footnote', 'x¹', () => beginDialog('footnote'))}
        {toolbarButton('Add comment', '☷', () => beginDialog('comment'))}
        {toolbarButton('Suggest a change', '±', () => beginDialog('suggest'))}<span className="writer-toolbar-space" />
        <button className={`writer-tracking-toggle ${tracking ? 'active' : ''}`} aria-label="Track text changes" aria-pressed={tracking} title="Track typing, deletions and single-paragraph pastes as suggestions" disabled={!editor} onClick={() => { setTracking(!tracking); setPanel('review') }}>{tracking ? '◉ Suggesting' : '○ Editing'}</button><i />
        {toolbarButton('Undo (⌘Z)', '↶', () => editor!.chain().focus().undo().run(), false, !editor?.can().undo())}{toolbarButton('Redo (⇧⌘Z)', '↷', () => editor!.chain().focus().redo().run(), false, !editor?.can().redo())}
      </div>
      {findOpen && <div className="writer-find"><input autoFocus placeholder="Find in chapter" aria-label="Find in chapter" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') searchMove(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setFindOpen(false) }} /><span>{editor ? searchKey.getState(editor.state)?.matches.length || 0 : 0} matches</span><button onClick={() => searchMove(-1)}>↑</button><button onClick={() => searchMove(1)}>↓</button><input placeholder="Replace with" aria-label="Replace with" value={replacement} onChange={e => setReplacement(e.target.value)} /><button onClick={() => replace(false)}>Replace</button><button onClick={() => replace(true)}>All</button><button aria-label="Close find" onClick={() => { setFindOpen(false); setQuery('') }}>×</button></div>}
      {error && <div className="writer-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button>{status === 'Unsaved' && <button onClick={() => void save()}>Retry save</button>}{error.includes('changed on disk') && <button onClick={() => void reloadDisk().catch(e => setError(errorText(e)))}>Reload disk version</button>}</div>}
      <div className="writer-workspace">
        <aside className="writer-outline">
          <div className="writer-panel-heading"><span>MANUSCRIPT</span><button title="Import DOCX" onClick={() => beginDialog('import')}>↓ Import</button></div>
          <div className="writer-book-list">{books.map(b => <section key={b.name}><h3>{b.name}<small>{b.chapters.reduce((n, c) => n + (c.path === doc?.path ? words : c.words), 0).toLocaleString()}</small></h3>{b.chapters.map(c => <div key={c.path} className={doc?.path === c.path ? 'writer-chapter selected' : 'writer-chapter'} draggable onDragStart={e => e.dataTransfer.setData('writer/chapter', c.path)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void reorderChapter(e.dataTransfer.getData('writer/chapter'), c.path) }}><button onClick={() => void open(c.path)}><span className="writer-chapter-icon">▤</span><span>{c.title}</span><small>{(doc?.path === c.path ? words : c.words).toLocaleString()}</small></button>{doc?.path === c.path && headings.filter(h => h.level >= 2).map(h => <button key={h.pos} className={`writer-outline-heading level-${h.level} ${scene?.pos === h.pos ? 'current' : ''}`} draggable onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('writer/scene', String(h.pos)) }} onDragOver={e => e.preventDefault()} onDrop={e => { e.stopPropagation(); e.preventDefault(); const from = e.dataTransfer.getData('writer/scene'); if (from) reorderScene(Number(from), h.pos) }} onClick={() => jump(h.pos)}><span>{h.title}</span><small>{h.words.toLocaleString()}</small></button>)}</div>)}</section>)}</div>
          {!books.length && <p className="writer-muted writer-outline-empty">Your manuscript lives here.<br />Create a chapter or import a Word document.</p>}
          <div className="writer-outline-footer"><button className={panel === 'snapshots' ? 'active' : ''} onClick={() => setPanel(panel === 'snapshots' ? null : 'snapshots')}>◷ Snapshots</button><details><summary>Export ↗</summary><div>{(['docx', 'pdf', 'md'] as const).map(format => <button disabled={!doc} key={format} onClick={async () => { try { const result = await api.ipc.invoke('export', { path: doc!.path, content: currentContent(), format, settings }); if (result) api.toast(`Exported ${format.toUpperCase()}`) } catch (e) { setError(errorText(e)) } }}>{format === 'docx' ? 'Word document' : format === 'pdf' ? 'PDF manuscript' : 'Markdown'}</button>)}</div></details></div>
        </aside>
        <div className={`writer-stage ${settings.layout === 'pages' ? 'writer-pages' : 'writer-continuous'} ${typewriter ? 'writer-typewriter' : ''}`} ref={stage} onMouseLeave={() => setHover(null)}>
          {doc ? <div className="writer-page-wrap"><div className="writer-page-caption"><span>{doc.path.split('/')[1]}</span><span>{settings.pageSize.toUpperCase()} · {settings.layout === 'pages' ? 'Page guides' : 'Continuous'}</span></div><ManuscriptEditor key={doc.path} content={doc.content} settings={settings} tracking={() => trackingRef.current} blocked={message => api.toast(message)} smart={() => settingsRef.current.smartTypography} onEditor={current => { setEditor(current); if (current) lastWords.current = wordCount(plainText(current.getJSON())) }} onChange={changed} onSelection={() => { setTick(t => t + 1); if (typewriter && stage.current && editor) { const rect = editor.view.coordsAtPos(editor.state.selection.from), parent = stage.current.getBoundingClientRect(); stage.current.scrollBy({ top: rect.top - parent.top - parent.height * .42, behavior: 'auto' }) } }} onWiki={inspect} onHover={showHover} /></div> : <div className="writer-welcome"><div className="writer-welcome-mark">⌁</div><p className="writer-eyebrow">REPROBATES ATLAS</p><h1>Give the story<br />a place to unfold.</h1><p>A quiet desk, with your world close at hand.</p><div><button className="writer-primary" onClick={() => beginDialog('create')}>Create a chapter</button><button onClick={() => beginDialog('import')}>Import a manuscript</button></div><small>Word documents from Google Docs are welcome.</small></div>}
        </div>
        {split && <aside className="writer-reference"><div className="writer-panel-heading"><span>REFERENCE · {titleOf(split.path)}</span><button aria-label="Close reference" onClick={() => setSplit(null)}>×</button></div><div className="writer-reference-content" dangerouslySetInnerHTML={{ __html: referenceMd.render(split.content) }} /></aside>}
        {panel && <aside className="writer-side"><nav className="writer-side-tabs"><button className={panel === 'lore' ? 'active' : ''} onClick={() => setPanel('lore')}>Lore</button><button className={panel === 'review' ? 'active' : ''} onClick={() => setPanel('review')}>Review {reviews.length > 0 && <small>{reviews.length}</small>}</button><button className={panel === 'snapshots' ? 'active' : ''} onClick={() => setPanel('snapshots')}>History</button><button title="Close side panel" onClick={() => setPanel(null)}>×</button></nav>
          {panel === 'lore' && <div className="writer-side-content">{selectedLore && <section className="writer-selected-lore"><div className="writer-panel-heading">LORE INSPECTOR<button aria-label="Close lore detail" onClick={() => setSelectedLore(null)}>×</button></div><h3>{lore.find(e => e.id === selectedLore)?.name}</h3><div dangerouslySetInnerHTML={{ __html: referenceMd.render(lore.find(e => e.id === selectedLore)?.content || '') }} /></section>}<div className="writer-panel-heading">WHO’S IN THIS SCENE</div><p className="writer-muted writer-scene-name">{scene?.title || 'Current chapter'}</p>{mentioned.filter(e => e.type === 'character').map(e => <button key={e.id} className="writer-person" onClick={() => inspect(e.name)} onMouseEnter={ev => showHover(e.name, ev.currentTarget)} onMouseLeave={() => setHover(null)}><span>{e.name[0]}</span><b>{e.name}</b><small>↗</small></button>)}{!mentioned.some(e => e.type === 'character') && <p className="writer-muted">Characters appear here when their names enter the scene.</p>}
            <div className="writer-panel-heading writer-section-heading">UNLINKED NAMES</div>{mentioned.filter(e => !currentContent().includes(`[[${e.name}`)).map(e => <div className="writer-name-suggestion" key={e.id}><button onClick={() => inspect(e.name)}>{e.name}</button><button title={`Link selected or unique mention of ${e.name}`} onClick={() => { try { linkMention(e.name) } catch (err) { api.toast(errorText(err)) } }}>Link ↗</button></div>)}
            <div className="writer-panel-heading writer-section-heading">LINK TO YOUR WORLD</div><input aria-label="Search lore" placeholder="Search names, places, things…" value={loreQuery} onChange={e => setLoreQuery(e.target.value)} /><div className="writer-lore-results">{lore.filter(e => loreQuery && e.name.toLocaleLowerCase().includes(loreQuery.toLocaleLowerCase())).slice(0, 15).map(e => <div key={e.id}><button onClick={() => inspect(e.name)}><b>{e.name}</b><small>{e.type}</small></button><button title="Insert lore link" disabled={!editor} onClick={() => addWiki(e)}>＋</button></div>)}</div><p className="writer-muted writer-lore-help">Type [[Name]] on the page to create a lore link. Hover for context; click to inspect.</p></div>}
          {panel === 'review' && <div className="writer-side-content"><label className="writer-track-label"><input type="checkbox" checked={tracking} onChange={e => setTracking(e.target.checked)} /><span>Track text changes<small>Typing, deletion and paste within one paragraph become suggestions. Switch to Editing for paragraph breaks and other structural edits.</small></span></label><div className="writer-review-heading"><span>{reviews.length} annotations</span><button disabled={!editor} onClick={() => beginDialog('comment')}>＋ Comment</button></div>{reviews.length === 0 && <p className="writer-muted">Select a passage, then add a comment or suggest a change from the toolbar.</p>}{reviews.map(r => <article className={`writer-review-card ${r.type}`} key={r.pos} onClick={() => jump(r.pos)}><small>{r.type === 'comment' ? 'COMMENT' : 'SUGGESTED CHANGE'}</small>{r.type === 'comment' ? <p>{r.text}</p> : <><del>{r.before || '(insertion)'}</del><ins>{r.after || '(deletion)'}</ins><div><button onClick={e => { e.stopPropagation(); accept(r, true) }}>Accept</button><button onClick={e => { e.stopPropagation(); accept(r, false) }}>Reject</button></div></>}{r.type === 'comment' && <button className="writer-resolve" onClick={e => { e.stopPropagation(); editor!.chain().focus().deleteRange({ from: r.pos, to: r.pos + r.size }).run() }}>Resolve</button>}</article>)}<label className="writer-draft-permission"><input type="checkbox" checked={canDraft} onChange={e => { draftingAllowed = e.target.checked; setCanDraft(e.target.checked) }} /><span>Allow assistant drafting this session<small>Comments and suggestions remain available. Drafting starts disabled.</small></span></label></div>}
          {panel === 'snapshots' && <div className="writer-side-content"><p className="writer-muted">Keep a checkpoint before a big revision.</p><button className="writer-wide" disabled={!doc} onClick={() => void snapshot().catch(e => setError(errorText(e)))}>＋ Save snapshot</button>{snapshots.map(s => <button className="writer-snapshot" key={s.id} onClick={async () => { const previous = await api.ipc.invoke('snapshots:read', { path: doc!.path, id: s.id }); setComparison({ snapshot: s, content: previous.content }) }}><b>{new Date(s.created).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b><small>{s.words.toLocaleString()} words · Compare ↗</small></button>)}</div>}
        </aside>}
      </div>
      <footer className="writer-status"><span className={`writer-save-state ${status === 'Unsaved' ? 'unsaved' : ''}`}>● {doc ? status : 'Ready'}</span><span>{words.toLocaleString()} chapter{scene && ` · ${scene.words.toLocaleString()} scene`} · {bookWords.toLocaleString()} book</span><span className="writer-goal" title={`${sessionWords} of ${settings.sessionGoal} session words`}><progress value={sessionWords} max={settings.sessionGoal || 1} />{sessionWords.toLocaleString()} / {settings.sessionGoal.toLocaleString()} session</span><span title="Net new words today">Today {dailyWords.toLocaleString()} / {settings.dailyGoal.toLocaleString()}</span><button className={typewriter ? 'active' : ''} title="Keep the current line near the center" onClick={() => setTypewriter(!typewriter)}>Typewriter</button><button className={panel ? 'active' : ''} onClick={() => setPanel(panel ? null : 'lore')}>Context ◧</button></footer>
      {showSetup && <div className="writer-settings-popover"><div className="writer-panel-heading">DOCUMENT SETTINGS<button onClick={() => setShowSetup(false)}>×</button></div><label>Layout<select value={settings.layout} onChange={e => changeSettings({ layout: e.target.value as any })}><option value="pages">Page guides</option><option value="continuous">Continuous</option></select></label><label>Font<select value={settings.font} onChange={e => changeSettings({ font: e.target.value })}>{['Fraunces', 'Inter', 'Georgia', 'Times New Roman', 'Courier New', 'Arial'].map(f => <option key={f}>{f}</option>)}</select></label><label>Size<input aria-label="Font size" type="number" min="10" max="40" value={settings.fontSize} onChange={e => changeSettings({ fontSize: Number(e.target.value) })} /><span>px</span></label><label>Paper<select value={settings.pageSize} onChange={e => changeSettings({ pageSize: e.target.value as any })}><option value="letter">US Letter</option><option value="a4">A4</option></select></label><label>Margins<input aria-label="Page margins" type="number" min="24" max="144" value={settings.margin} onChange={e => changeSettings({ margin: Number(e.target.value) })} /><span>px</span></label><label>Line spacing<select value={settings.lineSpacing} onChange={e => changeSettings({ lineSpacing: Number(e.target.value) })}>{[1, 1.25, 1.5, 1.85, 2, 2.5].map(n => <option key={n}>{n}</option>)}</select></label><label>First line indent<input aria-label="First line indent" type="number" min="0" max="96" value={settings.firstLineIndent} onChange={e => changeSettings({ firstLineIndent: Number(e.target.value) })} /><span>px</span></label><label>Print header<input value={settings.header} onChange={e => changeSettings({ header: e.target.value })} placeholder="Book / author" /></label><label><input type="checkbox" checked={settings.pageNumbers} onChange={e => changeSettings({ pageNumbers: e.target.checked })} />Page numbers in exports</label><label><input type="checkbox" checked={settings.smartTypography} onChange={e => changeSettings({ smartTypography: e.target.checked })} />Smart quotes & dashes</label><label><input type="checkbox" checked={settings.spellcheck} onChange={e => changeSettings({ spellcheck: e.target.checked })} />Spellcheck</label><label>Session goal<input type="number" min="0" value={settings.sessionGoal} onChange={e => changeSettings({ sessionGoal: Number(e.target.value) })} /></label><label>Daily goal<input type="number" min="0" value={settings.dailyGoal} onChange={e => changeSettings({ dailyGoal: Number(e.target.value) })} /></label><button className="writer-wide" onClick={() => changeSettings({ font: 'Times New Roman', fontSize: 16, margin: 96, lineSpacing: 2, firstLineIndent: 48, pageSize: 'letter', pageNumbers: true, layout: 'pages' })}>Standard manuscript preset</button><p className="writer-muted">Page guides show paper proportions. Exports paginate with these settings.</p></div>}
      {hover && <div className="writer-hover" style={{ left: hover.x, top: hover.y }} onMouseEnter={() => setHover(hover)} onMouseLeave={() => setHover(null)}><small>LORE</small><b>{hover.name}</b><p>{hover.content}</p></div>}
      {dialog && <div className="writer-modal-backdrop" onMouseDown={() => setDialog(null)}><form className="writer-modal" onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void submitDialog() }}><div className="writer-modal-title"><h2>{({ create: 'A new chapter', import: 'Bring a manuscript in', link: 'Insert a link', footnote: 'Add a footnote', comment: 'Leave a comment', suggest: 'Suggest a change' })[dialog]}</h2><button type="button" onClick={() => setDialog(null)}>×</button></div>{(dialog === 'create' || dialog === 'import') && <><label>Book<input autoFocus list="writer-books" value={fields.book || ''} onChange={e => setFields({ ...fields, book: e.target.value })} /><datalist id="writer-books">{books.map(b => <option key={b.name}>{b.name}</option>)}</datalist></label>{dialog === 'create' ? <label>Chapter title<input value={fields.title || ''} placeholder="Chapter One" onChange={e => setFields({ ...fields, title: e.target.value })} /></label> : <p className="writer-muted">Choose a .docx file next. Its title becomes the chapter name. Google Docs: File → Download → Microsoft Word.</p>}</>}{dialog === 'link' && <label>Address<input autoFocus placeholder="https://" value={fields.url || ''} onChange={e => setFields({ ...fields, url: e.target.value })} /></label>}{['footnote', 'comment', 'suggest'].includes(dialog) && <>{fields.quote && <blockquote>{fields.quote}</blockquote>}<label>{dialog === 'suggest' ? 'Suggested replacement (leave empty to delete)' : dialog === 'comment' ? 'Your comment' : 'Footnote text'}<textarea autoFocus rows={5} value={fields.text || ''} onChange={e => setFields({ ...fields, text: e.target.value })} /></label></>}{error && <p className="writer-error">{error}</p>}<div className="writer-modal-actions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="writer-primary">{dialog === 'import' ? 'Choose Word document' : dialog === 'create' ? 'Create chapter' : 'Add'}</button></div></form></div>}
      {splitPicker && <div className="writer-modal-backdrop" onMouseDown={() => setSplitPicker(false)}><div className="writer-modal writer-split-picker" onMouseDown={e => e.stopPropagation()}><h2>Keep a reference beside you</h2><input aria-label="Find reference" placeholder="Search manuscript or lore notes…" value={loreQuery} onChange={e => setLoreQuery(e.target.value)} autoFocus />{Array.from(api.store.getState().files.entries()).filter(([p, text]) => text && p.endsWith('.md') && p.toLocaleLowerCase().includes(loreQuery.toLocaleLowerCase())).slice(0, 80).map(([path, text]) => <button key={path} onClick={() => { setSplit({ path, content: text! }); setSplitPicker(false) }}><b>{titleOf(path)}</b><small>{path.startsWith('Manuscript/') ? 'Manuscript' : 'Lore'} · {path}</small></button>)}</div></div>}
      {comparison && <div className="writer-modal-backdrop"><div className="writer-compare"><div className="writer-modal-title"><h2>Compare snapshot · {new Date(comparison.snapshot.created).toLocaleString()}</h2><button onClick={() => setComparison(null)}>×</button></div><div className="writer-diff"><div className="writer-diff-legend"><del>Snapshot text removed</del><ins>Current text added</ins></div><pre>{diffWords(comparison.content, currentContent()).map((part, i) => part.added ? <ins key={i}>{part.value}</ins> : part.removed ? <del key={i}>{part.value}</del> : <span key={i}>{part.value}</span>)}</pre></div><div className="writer-modal-actions"><span>A new snapshot is saved before restoring.</span><button onClick={() => setComparison(null)}>Close</button><button className="writer-primary" onClick={async () => { await snapshot(); reloadContent(comparison.content); setComparison(null); await save() }}>Restore snapshot</button></div></div></div>}
    </div>
  }

  const dispose = api.views.register({ id: 'write', title: 'Write', icon: <span>⌁</span>, component: Writer })
  const command = api.commands.register({ id: 'open-write', title: 'Write manuscript', shortcut: 'mod+shift+w', run: () => api.views.show('write') })
  return () => { dispose(); command(); style.remove(); for (const path of documents.keys()) void persist(path).catch(e => api.toast(errorText(e))) }
}

function ManuscriptEditor({ content, settings, smart, tracking, blocked, onEditor, onChange, onSelection, onWiki, onHover }: { content: string; settings: WriterSettings; smart(): boolean; tracking(): boolean; blocked(message: string): void; onEditor(editor: Editor | null): void; onChange(content: string, editor: Editor): void; onSelection(): void; onWiki(target: string, element: HTMLElement): void; onHover(target: string, element: HTMLElement): void }) {
  const parsed = useMemo(() => parseManuscript(content), [])
  const callbacks = useRef({ onChange, onSelection, onWiki, onHover }); callbacks.current = { onChange, onSelection, onWiki, onHover }
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false, underline: false }), Underline, Link.configure({ openOnClick: false }), TextAlign.configure({ types: ['heading', 'paragraph'] }), SourceAttributes, WriterComment, WriterSuggestion, WriterWiki, WriterFootnote, WriterPageBreak, Search, inlineTracking({ enabled: tracking, blocked }), writerBehavior({ smart, onWiki: (t, e) => callbacks.current.onWiki(t, e), onHover: (t, e) => callbacks.current.onHover(t, e) })],
    content: parsed.html,
    editorProps: { attributes: { class: 'writer-prose', 'aria-label': 'Manuscript editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: String(settings.spellcheck) } },
    onCreate({ editor: e }) { bindSource(e.getJSON(), parsed.source); (e.storage as any).writerSource = parsed.source; onEditor(e) },
    onUpdate({ editor: e }) { callbacks.current.onChange(serializeManuscript(e.getJSON(), (e.storage as any).writerSource || parsed.source), e) },
    onSelectionUpdate() { callbacks.current.onSelection() },
    onTransaction() { callbacks.current.onSelection() },
  })
  useEffect(() => { editor?.setOptions({ editorProps: { attributes: { class: 'writer-prose', 'aria-label': 'Manuscript editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: String(settings.spellcheck) } } }) }, [settings.spellcheck, editor])
  useEffect(() => () => onEditor(null), [])
  const pageWidth = settings.pageSize === 'letter' ? 816 : 794
  return <div className="writer-paper" style={{ '--writer-font': `"${settings.font === 'Fraunces' ? 'Fraunces Variable' : settings.font === 'Inter' ? 'Inter Variable' : settings.font}", Georgia, serif`, '--writer-size': `${settings.fontSize}px`, '--writer-spacing': settings.lineSpacing, '--writer-margin': `${settings.margin}px`, '--writer-indent': `${settings.firstLineIndent}px`, '--writer-page-width': `${pageWidth}px`, '--writer-page-height': `${settings.pageSize === 'letter' ? 1056 : 1123}px` } as CSSProperties}><EditorContent editor={editor} /></div>
}
