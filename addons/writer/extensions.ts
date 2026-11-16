import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
const decoded = (value: string | null) => decodeURIComponent(value || '')
export const SourceAttributes = Extension.create({
  name: 'writerSource',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'writerPageBreak'], attributes: {
    sourceId: { default: null, parseHTML: e => e.getAttribute('data-source-id'), renderHTML: a => a.sourceId ? { 'data-source-id': a.sourceId } : {} },
    writerStyle: { default: null, parseHTML: e => e.getAttribute('data-writer-style'), renderHTML: a => a.writerStyle ? { 'data-writer-style': a.writerStyle } : {} },
    indent: { default: 0, parseHTML: e => parseFloat(e.style.marginLeft || '0') / (e.style.marginLeft.endsWith('px') ? 16 : 1), renderHTML: a => a.indent ? { style: `margin-left:${a.indent}em` } : {} },
  } }] },
})
export const WriterComment = Node.create({
  name: 'writerComment', group: 'inline', inline: true, atom: true,
  addAttributes() { return { text: { default: '', parseHTML: e => decoded(e.getAttribute('data-writer-comment')) } } },
  parseHTML() { return [{ tag: 'span[data-writer-comment]' }] },
  renderHTML({ node }) { return ['span', { 'data-writer-comment': encodeURIComponent(node.attrs.text), class: 'writer-comment-pin', title: node.attrs.text, contenteditable: 'false' }, '●'] },
})
export const WriterSuggestion = Node.create({
  name: 'writerSuggestion', group: 'inline', inline: true, atom: true,
  addAttributes() { return {
    before: { default: '', parseHTML: e => decoded(e.getAttribute('data-before')) },
    after: { default: '', parseHTML: e => decoded(e.getAttribute('data-after')) },
  } },
  parseHTML() { return [{ tag: 'span[data-writer-suggestion]' }] },
  renderHTML({ node }) { return ['span', { 'data-writer-suggestion': 'true', 'data-before': encodeURIComponent(node.attrs.before), 'data-after': encodeURIComponent(node.attrs.after), class: 'writer-suggestion', contenteditable: 'false' }, ['del', {}, node.attrs.before], ['ins', {}, node.attrs.after]] },
})
export const WriterWiki = Node.create({
  name: 'writerWiki', group: 'inline', inline: true, atom: true,
  addAttributes() { return {
    target: { default: '', parseHTML: e => decoded(e.getAttribute('data-writer-wiki')) },
    label: { default: '', parseHTML: e => decoded(e.getAttribute('data-label')) },
  } },
  parseHTML() { return [{ tag: 'span[data-writer-wiki]' }] },
  renderHTML({ node }) { return ['span', { class: 'writer-wiki', 'data-writer-wiki': encodeURIComponent(node.attrs.target), 'data-label': encodeURIComponent(node.attrs.label), tabindex: '0', role: 'button', title: `Open ${node.attrs.target} in lore` }, node.attrs.label || node.attrs.target] },
})
export const WriterFootnote = Node.create({
  name: 'writerFootnote', group: 'inline', inline: true, atom: true,
  addAttributes() { return { id: { default: '1', parseHTML: e => decoded(e.getAttribute('data-writer-footnote')) } } },
  parseHTML() { return [{ tag: 'span[data-writer-footnote]' }] },
  renderHTML({ node }) { return ['sup', { 'data-writer-footnote': encodeURIComponent(node.attrs.id), class: 'writer-footnote', title: `Footnote ${node.attrs.id}` }, node.attrs.id] },
})
export const WriterPageBreak = Node.create({
  name: 'writerPageBreak', group: 'block', atom: true, selectable: true,
  parseHTML() { return [{ tag: 'div[data-writer-pagebreak]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-writer-pagebreak': 'true', class: 'writer-page-break', contenteditable: 'false' }), 'PAGE BREAK'] },
})

export const searchKey = new PluginKey<{ query: string; matches: { from: number; to: number }[] }>('writerFind')
export const Search = Extension.create({
  name: 'writerFind',
  addProseMirrorPlugins() { return [new Plugin({
    key: searchKey,
    state: {
      init: () => ({ query: '', matches: [] as { from: number; to: number }[] }),
      apply(tr, previous) {
        const query = tr.getMeta(searchKey) ?? previous.query
        if (!tr.docChanged && query === previous.query) return previous
        const matches: { from: number; to: number }[] = []
        if (query) tr.doc.descendants((node, pos) => {
          if (!node.isTextblock) return
          const text = node.textBetween(0, node.content.size, '', '\ufffc').toLocaleLowerCase(), needle = query.toLocaleLowerCase()
          let start = 0, found: number
          while ((found = text.indexOf(needle, start)) !== -1) { matches.push({ from: pos + 1 + found, to: pos + 1 + found + query.length }); start = found + query.length }
          return false
        })
        return { query, matches }
      },
    },
    props: { decorations(state) { return DecorationSet.create(state.doc, (searchKey.getState(state)?.matches || []).map(m => Decoration.inline(m.from, m.to, { class: 'writer-search-match' }))) } },
  })] },
})
export function writerBehavior(options: { smart: () => boolean; onWiki(target: string, element: HTMLElement): void; onHover(target: string, element: HTMLElement): void }) {
  return Extension.create({
    name: 'writerBehavior',
    addKeyboardShortcuts() { return {
      Tab: () => { const e = this.editor; if (e.isActive('listItem')) return e.commands.sinkListItem('listItem'); return indent(e, 1) },
      'Shift-Tab': () => { const e = this.editor; if (e.isActive('listItem')) return e.commands.liftListItem('listItem'); return indent(e, -1) },
    } },
    addProseMirrorPlugins() { return [new Plugin({ props: {
      handleTextInput(view, from, to, text) {
        const before = view.state.doc.textBetween(Math.max(0, from - 4), from, '\n')
        if (text === ']' && /\[\[[^\]\n]+\]$/.test(view.state.doc.textBetween(Math.max(0, from - 120), from))) {
          const match = view.state.doc.textBetween(Math.max(0, from - 120), from).match(/\[\[([^\]\n]+)\]$/)!
          const [target, label = ''] = match[1].split('|')
          const tr = view.state.tr.replaceWith(from - match[0].length, to, view.state.schema.nodes.writerWiki.create({ target, label }))
          view.dispatch(tr); return true
        }
        if (!options.smart()) return false
        let replacement = text
        if (text === '"') replacement = !before || /[\s([{—]$/.test(before) ? '“' : '”'
        if (text === "'") replacement = !before || /[\s([{—]$/.test(before) ? '‘' : '’'
        if (replacement !== text) { view.dispatch(view.state.tr.insertText(replacement, from, to)); return true }
        if (text === '-' && before.endsWith('-')) { view.dispatch(view.state.tr.insertText('—', from - 1, to)); return true }
        if (text === '.' && before.endsWith('..')) { view.dispatch(view.state.tr.insertText('…', from - 2, to)); return true }
        return false
      },
      handleDOMEvents: {
        click(_view, event) { const el = (event.target as HTMLElement).closest<HTMLElement>('[data-writer-wiki]'); if (el) { options.onWiki(decoded(el.dataset.writerWiki || ''), el); return true } return false },
        mouseover(_view, event) { const el = (event.target as HTMLElement).closest<HTMLElement>('[data-writer-wiki]'); if (el) options.onHover(decoded(el.dataset.writerWiki || ''), el); return false },
      },
    } })] },
  })
}
export function indent(editor: Editor, amount: number) {
  const type = editor.isActive('heading') ? 'heading' : 'paragraph'
  const old = editor.getAttributes(type).indent || 0
  return editor.chain().focus().updateAttributes(type, { indent: Math.max(0, Math.min(12, old + amount * 2)) }).run()
}
export function selectQuote(editor: Editor, quote: string) {
  const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
  if (selected === quote && quote) return { from: editor.state.selection.from, to: editor.state.selection.to }
  const found: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const text = node.textBetween(0, node.content.size, '', '\ufffc')
    let start = 0, at: number
    while ((at = text.indexOf(quote, start)) >= 0) { found.push({ from: pos + 1 + at, to: pos + 1 + at + quote.length }); start = at + Math.max(quote.length, 1) }
    return false
  })
  if (!quote || found.length !== 1) throw new Error(found.length > 1 ? 'This quote occurs more than once. Select the intended passage in Write.' : 'The quote was not found in the open manuscript.')
  return found[0]
}

/** Text revisions are atoms so an accept/reject is one undoable edit and portable CriticMarkup. */
export function inlineTracking(options: { enabled(): boolean; blocked(message: string): void }) {
  return Extension.create({
    name: 'writerTracking', priority: 1100,
    addProseMirrorPlugins() { return [new Plugin({ props: {
      handleTextInput(view, from, to, text) {
        if (!options.enabled()) return false
        return trackedInsert(view, from, to, text, options.blocked)
      },
      handlePaste(view, event) {
        if (!options.enabled()) return false
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        if (/[\r\n]/.test(text)) { options.blocked('Suggesting tracks text within one paragraph. Switch to Editing to paste multiple paragraphs.'); return true }
        return trackedInsert(view, view.state.selection.from, view.state.selection.to, text, options.blocked)
      },
      handleKeyDown(view, event) {
        if (!options.enabled()) return false
        if (event.key === 'Enter') { options.blocked('Paragraph breaks are structural edits. Switch to Editing to add or remove them.'); return true }
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false
        const { from, to, $from, $to } = view.state.selection
        if (from !== to) return trackedInsert(view, from, to, '', options.blocked)
        const back = event.key === 'Backspace', adjacent = back ? $from.nodeBefore : $from.nodeAfter
        const boundary = back ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size
        if (boundary) { options.blocked('Paragraph joins are structural edits. Switch to Editing to add or remove them.'); return true }
        if (adjacent?.type.name === 'writerSuggestion') {
          const nodePos = back ? from - adjacent.nodeSize : from
          const before = adjacent.attrs.before as string, after = adjacent.attrs.after as string
          if (after) {
            const letters = Array.from(after), next = (back ? letters.slice(0, -1) : letters.slice(1)).join('')
            const tr = view.state.tr
            if (!next && !before) tr.delete(nodePos, nodePos + adjacent.nodeSize)
            else tr.setNodeMarkup(nodePos, undefined, { before, after: next })
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(back ? nodePos + (next || before ? 1 : 0) : nodePos, tr.doc.content.size))))
            view.dispatch(tr); return true
          }
          const edge = back ? nodePos : nodePos + adjacent.nodeSize
          const resolved = view.state.doc.resolve(edge)
          if (back ? resolved.parentOffset === 0 : resolved.parentOffset === resolved.parent.content.size) { options.blocked('Paragraph joins are structural edits. Switch to Editing to add or remove them.'); return true }
          const neighbor = back ? resolved.nodeBefore : resolved.nodeAfter
          if (!neighbor?.isText) { options.blocked('Resolve adjacent annotations before deleting across them.'); return true }
          const char = back ? Array.from(neighbor.text!).at(-1)! : Array.from(neighbor.text!)[0]
          const start = back ? edge - char.length : nodePos, end = back ? nodePos + adjacent.nodeSize : edge + char.length
          const tr = view.state.tr.replaceWith(start, end, view.state.schema.nodes.writerSuggestion.create({ before: back ? char + before : before + char, after: '' }))
          tr.setSelection(TextSelection.near(tr.doc.resolve(back ? start + 1 : start)))
          view.dispatch(tr); return true
        }
        if (!adjacent?.isText) { options.blocked('Resolve adjacent annotations before deleting across them.'); return true }
        const text = adjacent.text!, char = back ? Array.from(text).at(-1)! : Array.from(text)[0]
        let length = char.length
        if (event.altKey || event.ctrlKey) length = (back ? text.match(/\S+\s*$/)?.[0] : text.match(/^\s*\S+/)?.[0])?.length || length
        if (event.metaKey) length = text.length
        return trackedInsert(view, back ? from - length : from, back ? from : from + length, '', options.blocked, back)
      },
    } })] },
  })
}
function trackedInsert(view: import('@tiptap/pm/view').EditorView, from: number, to: number, after: string, blocked: (message: string) => void, caretAfter = true) {
  const $from = view.state.doc.resolve(from), $to = view.state.doc.resolve(to)
  if (!$from.sameParent($to) || !$from.parent.isTextblock || /[\r\n]/.test(after)) { blocked('Suggesting tracks text within one paragraph. Switch to Editing for structural edits.'); return true }
  let annotated = false
  view.state.doc.nodesBetween(from, to, node => { if (node.isAtom && !node.isText) annotated = true })
  if (annotated) { blocked('Resolve selected annotations before replacing them.'); return true }
  const before = view.state.doc.textBetween(from, to, '')
  if (!before && !after) return true
  const previous = from === to ? $from.nodeBefore : null
  let position = from, attrs = { before, after }
  if (previous?.type.name === 'writerSuggestion') {
    position -= previous.nodeSize
    attrs = { before: previous.attrs.before, after: previous.attrs.after + after }
  }
  const tr = view.state.tr.replaceWith(position, to, view.state.schema.nodes.writerSuggestion.create(attrs))
  tr.setSelection(TextSelection.near(tr.doc.resolve(position + (caretAfter ? 1 : 0))))
  view.dispatch(tr); return true
}
