// Obsidian-style live preview for CodeMirror 6: markdown markers are hidden and content is rendered in place,
// except on the lines the selection touches, where the raw text shows for editing. The document text is never changed
// by the preview itself (only by checkbox clicks, which edit one character).
import { EditorState, RangeSetBuilder, StateField, type Range, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import MarkdownIt from 'markdown-it'

export interface LivePreviewHooks {
  openLink(target: string, heading?: string): void
  imageUrl(target: string): string | null
}

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string, readonly onClick?: () => void) {
    super()
  }
  eq(o: TextWidget) {
    return o.text === this.text && o.cls === this.cls
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = this.cls
    s.textContent = this.text
    if (this.onClick) {
      s.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.onClick!()
      })
    }
    return s
  }
  ignoreEvent() {
    return !!this.onClick
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super()
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos
  }
  toDOM(view: EditorView) {
    const b = document.createElement('input')
    b.type = 'checkbox'
    b.className = 'cm-lp-check'
    b.checked = this.checked
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return b
  }
  ignoreEvent() {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string) {
    super()
  }
  eq(o: ImageWidget) {
    return o.src === this.src
  }
  toDOM() {
    const i = document.createElement('img')
    i.className = 'cm-lp-img'
    i.src = this.src
    return i
  }
}

const md = new MarkdownIt({ html: false })
class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(o: TableWidget) {
    return o.source === this.source
  }
  toDOM() {
    const d = document.createElement('div')
    d.className = 'cm-lp-table prose'
    d.innerHTML = md.render(this.source)
    return d
  }
}

const hide = Decoration.replace({})
const WIKI = /(!?)\[\[([^\[\]\n|#]*)(?:#([^\[\]\n|]*))?(?:\|([^\[\]\n]*))?\]\]/g

function build(state: EditorState, hooks: LivePreviewHooks): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = state.doc
  // lines touched by any selection range show raw markdown
  const active = new Set<number>()
  for (const r of state.selection.ranges) for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) active.add(l)
  const isActive = (from: number, to = from) => {
    for (let l = doc.lineAt(from).number; l <= doc.lineAt(to).number; l++) if (active.has(l)) return true
    return false
  }
  const lineDeco = (pos: number, cls: string) => decos.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from))
  const codeRanges: [number, number][] = []

  syntaxTree(state).iterate({
    enter: (n) => {
      const name = n.name
      if (/^ATXHeading(\d)$/.test(name)) {
        lineDeco(n.from, `cm-lp-h cm-lp-h${name.slice(-1)}`)
        return
      }
      if (name === 'HeaderMark') {
        if (!isActive(n.from)) {
          const after = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to
          decos.push(hide.range(n.from, after))
        }
        return
      }
      if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'LinkMark' || name === 'URL') {
        if (!isActive(n.from)) decos.push(hide.range(n.from, n.to))
        return
      }
      if (name === 'CodeMark') {
        const parent = n.node.parent?.name
        if (parent === 'InlineCode' && !isActive(n.from)) decos.push(hide.range(n.from, n.to))
        if (parent === 'FencedCode') lineDeco(n.from, 'cm-lp-fence')
        return
      }
      if (name === 'FencedCode' || name === 'CodeBlock') {
        codeRanges.push([n.from, n.to])
        for (let l = doc.lineAt(n.from).number; l <= doc.lineAt(n.to).number; l++) decos.push(Decoration.line({ class: 'cm-lp-codeblock' }).range(doc.line(l).from))
        return false
      }
      if (name === 'InlineCode') {
        codeRanges.push([n.from, n.to])
        decos.push(Decoration.mark({ class: 'cm-lp-code' }).range(n.from, n.to))
        return
      }
      if (name === 'QuoteMark') {
        lineDeco(n.from, 'cm-lp-quote')
        if (!isActive(n.from)) decos.push(hide.range(n.from, Math.min(n.to + 1, doc.lineAt(n.from).to)))
        return
      }
      if (name === 'ListMark') {
        const text = doc.sliceString(n.from, n.to)
        const task = /^\s*\[[ xX]\]/.test(doc.sliceString(n.to + 1, n.to + 5))
        if (!isActive(n.from) && /^[-*+]$/.test(text)) decos.push(Decoration.replace({ widget: new TextWidget(task ? '' : '•', 'cm-lp-bullet') }).range(n.from, n.to))
        return
      }
      if (name === 'TaskMarker') {
        if (!isActive(n.from)) decos.push(Decoration.replace({ widget: new CheckboxWidget(/x/i.test(doc.sliceString(n.from, n.to)), n.from) }).range(n.from, n.to))
        return
      }
      if (name === 'Table') {
        if (!isActive(n.from, n.to)) decos.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(n.from, n.to)), block: true }).range(n.from, n.to))
        return false
      }
      if (name === 'HorizontalRule' && !isActive(n.from)) {
        decos.push(Decoration.replace({ widget: new TextWidget('', 'cm-lp-hr') }).range(n.from, n.to))
      }
    }
  })

  // wikilinks and embeds (not part of the markdown grammar)
  const text = doc.toString()
  WIKI.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKI.exec(text))) {
    const from = m.index, to = from + m[0].length
    if (codeRanges.some(([a, b]) => from >= a && to <= b)) continue
    if (isActive(from, to)) {
      decos.push(Decoration.mark({ class: 'cm-lp-wikiraw' }).range(from, to))
      continue
    }
    const [, embed, target, heading, alias] = m
    const img = embed ? hooks.imageUrl(target) : null
    if (img) decos.push(Decoration.replace({ widget: new ImageWidget(img) }).range(from, to))
    else {
      const label = alias ?? (heading ? (target ? `${target} › ${heading}` : heading) : target)
      decos.push(Decoration.replace({ widget: new TextWidget(label, 'cm-lp-link', () => hooks.openLink(target, heading)) }).range(from, to))
    }
  }

  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  const builder = new RangeSetBuilder<Decoration>()
  let lastTo = -1
  for (const d of decos) {
    // skip replacements that overlap an earlier replacement
    const isReplace = (d.value as any).point || (d.value.spec && (d.value.spec.widget || d.value.spec.block))
    if (isReplace && d.from < lastTo) continue
    builder.add(d.from, d.to, d.value)
    if (isReplace) lastTo = Math.max(lastTo, d.to)
  }
  return builder.finish()
}

export function livePreview(hooks: LivePreviewHooks): Extension {
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, hooks),
    update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? build(tr.state, hooks) : deco),
    provide: (f) => EditorView.decorations.from(f)
  })
  return [
    field,
    EditorView.baseTheme({
      '.cm-lp-h1': { fontSize: '1.55em', fontFamily: 'var(--font-serif)', fontWeight: '450', lineHeight: '1.35', paddingTop: '0.4em' },
      '.cm-lp-h2': { fontSize: '1.3em', fontFamily: 'var(--font-serif)', fontWeight: '450', paddingTop: '0.5em' },
      '.cm-lp-h3, .cm-lp-h4, .cm-lp-h5, .cm-lp-h6': { fontSize: '1.1em', fontFamily: 'var(--font-serif)', fontWeight: '500', paddingTop: '0.35em' },
      '.cm-lp-link': { color: 'var(--accent)', borderBottom: '1px solid rgba(240,194,126,0.3)', cursor: 'pointer' },
      '.cm-lp-wikiraw': { color: 'var(--accent)' },
      '.cm-lp-bullet': { color: 'var(--accent)', display: 'inline-block', width: '0.9em' },
      '.cm-lp-check': { margin: '0 6px 0 0', accentColor: 'var(--accent)', verticalAlign: 'middle', cursor: 'pointer' },
      '.cm-lp-quote': { borderLeft: '2px solid rgba(240,194,126,0.25)', paddingLeft: '12px !important', color: 'var(--text-2)' },
      '.cm-lp-code': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.86em', background: 'var(--bg-2)', borderRadius: '4px', padding: '0.1em 0.3em' },
      '.cm-lp-codeblock': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.86em', background: 'var(--bg-1)' },
      '.cm-lp-fence': { color: 'var(--text-4)' },
      '.cm-lp-img': { maxWidth: '100%', borderRadius: '8px', display: 'block', margin: '6px 0' },
      '.cm-lp-hr': { display: 'inline-block', width: '100%', borderTop: '1px solid var(--line-2)', verticalAlign: 'middle' },
      '.cm-lp-table': { padding: '4px 0', fontSize: '0.9em' }
    })
  ]
}
