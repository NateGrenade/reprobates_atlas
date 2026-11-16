// Plain CodeMirror 6 markdown source editor (live preview arrives in S10).
import { useEffect, useRef } from 'react'
import { EditorState, EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { autocompletion, closeBrackets, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { search, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import type { VaultIndex } from '@core/vault'
import { livePreview, type LivePreviewHooks } from './livePreview'

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontFamily: 'var(--font-serif)', fontSize: '1.55em', fontWeight: '450', color: 'var(--text)' },
  { tag: t.heading2, fontFamily: 'var(--font-serif)', fontSize: '1.3em', fontWeight: '450', color: 'var(--text)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontFamily: 'var(--font-serif)', fontSize: '1.1em', fontWeight: '500', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--text)' },
  { tag: t.strong, fontWeight: '650', color: 'var(--text)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-3)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.88em', color: '#c9c2ff' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-4)' },
  { tag: t.list, color: 'var(--accent)' }
])

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: 'calc(15px * var(--ui-scale))', color: '#dcd8e8', backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: 'var(--font-serif)', lineHeight: '1.7', padding: '8px 0 120px' },
    '.cm-content': { caretColor: 'var(--accent-hi)', maxWidth: '720px', margin: '0 auto', padding: '0 8px' },
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(196,188,255,0.025)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(240,194,126,0.22) !important' },
    '.cm-cursor': { borderLeftColor: 'var(--accent-hi)', borderLeftWidth: '1.5px' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: 'calc(12.5px * var(--ui-scale))', maxHeight: '260px' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '5px 10px !important', color: 'var(--text-2)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-dim) !important', color: 'var(--accent-hi) !important' },
    '.cm-completionDetail': { color: 'var(--text-4)', fontStyle: 'normal', marginLeft: '10px' },
    '.cm-panels': { backgroundColor: 'var(--bg-2)', color: 'var(--text)', borderColor: 'var(--line-2)' },
    '.cm-placeholder': { color: 'var(--text-4)', fontStyle: 'italic' }
  },
  { dark: true }
)

/** `[[` autocomplete over note names and, after `#`, that note's headings. */
function wikilinkCompletion(getIndex: () => VaultIndex | null) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^\]\[|\n]*/)
    if (!m) return null
    const ix = getIndex()
    if (!ix) return null
    const inner = m.text.slice(2)
    const hash = inner.indexOf('#')
    const closeAfter = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]' ? '' : ']]'
    if (hash >= 0) {
      const path = ix.resolver.resolve(inner.slice(0, hash))
      const note = path ? ix.notes.get(path) : null
      if (!note) return null
      return {
        from: m.from + 2 + hash + 1,
        options: note.headings.map((h) => ({ label: h.text, type: 'property', detail: 'H' + h.level, apply: h.text + closeAfter })),
        validFor: /^[^\]\n]*$/
      }
    }
    const names = new Map<string, string>()
    for (const p of ix.notes.keys()) {
      const n = p.split('/').pop()!.replace(/\.md$/i, '')
      if (!names.has(n)) names.set(n, p.split('/').slice(0, -1).join('/'))
    }
    return {
      from: m.from + 2,
      options: [...names].map(([n, dir]) => ({ label: n, detail: dir, type: 'text', apply: n + closeAfter })),
      validFor: /^[^\]#|\n]*$/
    }
  }
}

/** Wrap the selection with a marker, or toggle a line prefix. Exported for the toolbar. */
export function wrap(view: EditorView, before: string, after = before) {
  view.dispatch(
    view.state.changeByRange((r) => {
      const text = view.state.sliceDoc(r.from, r.to)
      if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
        const inner = text.slice(before.length, text.length - after.length)
        return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) }
      }
      return { changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }], range: EditorSelection.range(r.from + before.length, r.to + before.length) }
    })
  )
  view.focus()
  return true
}

export function linePrefix(view: EditorView, prefix: string) {
  const { state } = view
  const lines = new Set<number>()
  for (const r of state.selection.ranges) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l)
  const all = [...lines].map((n) => state.doc.line(n))
  const has = all.every((l) => l.text.startsWith(prefix))
  view.dispatch({ changes: all.map((l) => (has ? { from: l.from, to: l.from + prefix.length } : { from: l.from, insert: prefix })) })
  view.focus()
  return true
}

const formatKeys = keymap.of([
  { key: 'Mod-b', run: (v) => wrap(v, '**') },
  { key: 'Mod-i', run: (v) => wrap(v, '*') },
  { key: 'Mod-Shift-x', run: (v) => wrap(v, '~~') },
  { key: 'Mod-e', run: (v) => wrap(v, '`') },
  { key: 'Mod-l', run: (v) => wrap(v, '[[', ']]') }
])

interface Props {
  docKey: string
  value: string
  eol: '\n' | '\r\n'
  getIndex(): VaultIndex | null
  onChange(text: string): void
  onView?(v: EditorView | null): void
  /** Obsidian-style live preview (markers hidden off the cursor line) */
  live?: LivePreviewHooks
}

export function Editor({ docKey, value, eol, getIndex, onChange, onView, live }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const exts: Extension[] = [
      EditorState.lineSeparator.of(eol), // keep the file's own line endings
      history(),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      closeBrackets(),
      autocompletion({ override: [wikilinkCompletion(getIndex)], icons: false }),
      search(),
      formatKeys,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      placeholder('Write…'),
      ...(live ? [livePreview(live)] : []),
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) changeRef.current(u.state.doc.toString())
      })
    ]
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions: exts }), parent: host.current! })
    view.current = v
    onView?.(v)
    ;(window as any).__atlasEditor = v
    return () => {
      v.destroy()
      view.current = null
      onView?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, eol, !!live])

  // External change to the same document: replace content when it differs.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
  }, [value])

  return <div className="editor-host" ref={host} />
}
