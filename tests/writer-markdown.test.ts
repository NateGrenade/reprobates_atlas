import { afterEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { parseManuscript, bindSource, serializeManuscript, wordCount, plainText } from '../addons/writer/markdown'
import { SourceAttributes, WriterComment, WriterSuggestion, WriterWiki, WriterFootnote, WriterPageBreak, Search, searchKey, selectQuote, inlineTracking } from '../addons/writer/extensions'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const openEditors: Editor[] = []
afterEach(() => { for (const editor of openEditors.splice(0)) editor.destroy() })
function manuscript(content: string, tracking = false) {
  const parsed = parseManuscript(content)
  const blocked: string[] = []
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ underline: false }), Underline, TextAlign.configure({ types: ['heading', 'paragraph'] }), SourceAttributes, WriterComment, WriterSuggestion, WriterWiki, WriterFootnote, WriterPageBreak, Search, inlineTracking({ enabled: () => tracking, blocked: message => blocked.push(message) })], content: parsed.html })
  openEditors.push(editor)
  bindSource(editor.getJSON(), parsed.source)
  return { editor, blocked, save: () => serializeManuscript(editor.getJSON(), parsed.source) }
}
function replaceText(editor: Editor, old: string, value: string) {
  const range = selectQuote(editor, old)
  editor.commands.insertContentAt(range, { type: 'text', text: value })
}
describe('manuscript rich editor source fidelity', () => {
  it('counts prose across hard breaks and excludes footnote definitions', () => {
    const { editor } = manuscript('One  \ntwo[^1].\n\n[^1]: Extra footnote words\n')
    expect(wordCount(plainText(editor.getJSON()))).toBe(2)
  })
  it.runIf(Boolean(process.env.ATLAS_WRITER_REAL_FIXTURE))('round-trips the imported real manuscript and patches one unique phrase in place', () => {
    const original = readFileSync(process.env.ATLAS_WRITER_REAL_FIXTURE!, 'utf8')
    const { editor, save } = manuscript(original)
    expect(save()).toBe(original)
    const candidates = original.match(/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+ [A-Za-z]+/g) || []
    const quote = candidates.find(text => original.indexOf(text) === original.lastIndexOf(text) && editor.getText().includes(text))!
    expect(quote).toBeTruthy()
    replaceText(editor, quote, 'A verified local revision')
    expect(save()).toBe(original.replace(quote, 'A verified local revision'))
  })
  it('preserves all untouched bytes, including frontmatter, CRLF, alternate emphasis and blank lines', () => {
    const original = '---\r\nbook: Test\r\n---\r\n\r\n# A title\r\n\r\nA __bold__ and _italic_ sentence.\r\nWrapped onto another line.\r\n\r\n\r\n> A quotation.\r\n\r\n***\r\n\r\nA final paragraph.\r\n'
    expect(manuscript(original).save()).toBe(original)
  })
  it('changes exactly one sentence in a 5,000 word chapter', () => {
    const paragraphs = Array.from({ length: 100 }, (_, p) => Array.from({ length: 50 }, (_, w) => `word${p}x${w}`).join(' ') + '.')
    paragraphs[47] = paragraphs[47].replace('word47x20 word47x21', 'The old sentence')
    const original = '# Chapter One\n\n' + paragraphs.join('\n\n') + '\n'
    const { editor, save } = manuscript(original)
    replaceText(editor, 'The old sentence', 'The revised sentence')
    expect(wordCount(original)).toBeGreaterThan(4990)
    expect(save()).toBe(original.replace('The old sentence', 'The revised sentence'))
  })
  it('preserves alternate emphasis delimiters and wrapped whitespace around a text edit in the same paragraph', () => {
    const original = 'An __unusual__ beginning.\nA _quiet_ middle. The old sentence ends here.\nAn unchanged final line.\n\n'
    const { editor, save } = manuscript(original)
    replaceText(editor, 'The old sentence ends here.', 'The new sentence closes here.')
    expect(save()).toBe(original.replace('The old sentence ends here.', 'The new sentence closes here.'))
  })
  it('keeps Markdown punctuation typed as literal text on re-open', () => {
    const { editor, save } = manuscript('A plain paragraph.\n\n')
    replaceText(editor, 'plain', '*literal* [brackets] <angle>')
    const reopened = manuscript(save()).editor
    expect(reopened.getText()).toBe('A *literal* [brackets] <angle> paragraph.')
    expect(reopened.getJSON().content?.[0].content?.every(n => !n.marks?.length)).toBe(true)
  })
  it('preserves full CriticMarkup annotations and links until explicitly edited', () => {
    const original = 'A {~~wrong~>right~~} turn. {++New words++} {--Old words--} {>>Comment *with* [punctuation] & detail.<<} [[Elion|Eli]] [^1]\n\n[^1]: A note.\n\n<!-- pagebreak -->\n\n'
    const { editor, save } = manuscript(original)
    const names: string[] = []; editor.state.doc.descendants(n => { names.push(n.type.name) })
    expect(names.filter(n => n === 'writerSuggestion')).toHaveLength(3)
    expect(names).toContain('writerComment'); expect(names).toContain('writerWiki'); expect(names).toContain('writerFootnote'); expect(names).toContain('writerPageBreak')
    expect(save()).toBe(original)
    replaceText(editor, 'turn.', 'choice.')
    const next = save(); expect(next).toContain('{>>Comment *with* [punctuation] & detail.<<}')
    expect((manuscript(next).editor.getJSON() as any).content?.[0].content?.find((n: any) => n.type === 'writerComment')?.attrs?.text).toBe('Comment *with* [punctuation] & detail.')
  })
  it('accepts and rejects suggestions without leaving CriticMarkup behind', () => {
    for (const accept of [true, false]) {
      const { editor, save } = manuscript('A {~~wrong~>right~~} turn.\n\n')
      let pos = 0; editor.state.doc.descendants((node, at) => { if (node.type.name === 'writerSuggestion') pos = at })
      editor.commands.insertContentAt({ from: pos, to: pos + 1 }, { type: 'text', text: accept ? 'right' : 'wrong' })
      const serialized = save(); expect(serialized).toBe(`A ${accept ? 'right' : 'wrong'} turn.\n\n`)
      editor.commands.undo(); expect(save()).toBe('A {~~wrong~>right~~} turn.\n\n')
    }
  })
  it('finds literal strings and replaces the full match across formatting', () => {
    const { editor } = manuscript('One **quiet** morning. A quiet ending.\n\n')
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, 'quiet'))
    expect(searchKey.getState(editor.state)?.matches).toHaveLength(2)
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, 'One quiet morning'))
    expect(searchKey.getState(editor.state)?.matches).toHaveLength(1)
  })
  it('refuses an ambiguous quote unless it is the current selection', () => {
    const { editor } = manuscript('Again and again.\n\n')
    expect(() => selectQuote(editor, 'again')).not.toThrow()
    expect(() => selectQuote(manuscript('again again').editor, 'again')).toThrow('more than once')
    editor.commands.setTextSelection({ from: 11, to: 16 })
    expect(selectQuote(editor, 'again')).toEqual({ from: 11, to: 16 })
  })
  it('tracks actual typing and replacement input as one mergeable CriticMarkup suggestion', () => {
    const { editor, save } = manuscript('A quiet morning.\n\n', true)
    editor.commands.setTextSelection(selectQuote(editor, 'quiet'))
    for (const letter of 'loud') editor.view.someProp('handleTextInput', handler => (handler as any)(editor.view, editor.state.selection.from, editor.state.selection.to, letter))
    expect(save()).toBe('A {~~quiet~>loud~~} morning.\n\n')
  })
  it('tracks backspace and forward delete and allows their rejection', () => {
    for (const key of ['Backspace', 'Delete']) {
      const { editor, save } = manuscript('A quiet morning.\n\n', true)
      const range = selectQuote(editor, 'quiet'); editor.commands.setTextSelection(key === 'Backspace' ? range.to : range.from)
      for (let i = 0; i < 2; i++) editor.view.someProp('handleKeyDown', handler => handler(editor.view, new dom.window.KeyboardEvent('keydown', { key }) as any))
      expect(save()).toBe(key === 'Backspace' ? 'A qui{--et--} morning.\n\n' : 'A {--qu--}iet morning.\n\n')
      let suggestion: any; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'writerSuggestion') suggestion = { node, pos } })
      editor.commands.insertContentAt({ from: suggestion.pos, to: suggestion.pos + 1 }, { type: 'text', text: suggestion.node.attrs.before })
      expect(save()).toBe('A quiet morning.\n\n')
    }
  })
  it('tracks single-paragraph paste and blocks multiline edits without altering text', () => {
    const { editor, save, blocked } = manuscript('Original text.\n\n', true)
    editor.commands.setTextSelection(selectQuote(editor, 'Original'))
    editor.view.someProp('handlePaste', handler => (handler as any)(editor.view, { clipboardData: { getData: () => 'Pasted' } }, null))
    expect(save()).toBe('{~~Original~>Pasted~~} text.\n\n')
    const before = save()
    editor.view.someProp('handlePaste', handler => (handler as any)(editor.view, { clipboardData: { getData: () => 'Two\n\nparagraphs' } }, null))
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new dom.window.KeyboardEvent('keydown', { key: 'Enter' }) as any))
    expect(save()).toBe(before); expect(blocked).toHaveLength(2)
  })
})
