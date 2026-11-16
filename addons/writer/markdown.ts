import MarkdownIt from 'markdown-it'
import { diffChars } from 'diff'
import type { JSONContent } from '@tiptap/core'

const md = new MarkdownIt({ html: true, breaks: false, typographer: false })
const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const encode = (v: string) => escape(encodeURIComponent(v))
md.inline.ruler.before('escape', 'writer_syntax', (state, silent) => {
  const rest = state.src.slice(state.pos, state.posMax)
  const substitution = rest.match(/^\{~~([\s\S]*?)~>([\s\S]*?)~~\}/)
  const insertion = rest.match(/^\{\+\+([\s\S]*?)\+\+\}/)
  const deletion = rest.match(/^\{--([\s\S]*?)--\}/)
  const comment = rest.match(/^\{>>([\s\S]*?)<<\}/)
  const wiki = rest.match(/^\[\[([^\]\n]+)\]\]/)
  const footnote = rest.match(/^\[\^([^\]\n]+)\](?!:)/)
  const match = substitution || insertion || deletion || comment || wiki || footnote
  if (!match) return false
  if (!silent) {
    const token = state.push('html_inline', '', 0)
    if (substitution) token.content = suggestionHtml(substitution[1], substitution[2])
    if (insertion) token.content = suggestionHtml('', insertion[1])
    if (deletion) token.content = suggestionHtml(deletion[1], '')
    if (comment) token.content = `<span data-writer-comment="${encode(comment[1])}"></span>`
    if (wiki) { const [target, label = ''] = wiki[1].split('|'); token.content = `<span data-writer-wiki="${encode(target)}" data-label="${encode(label)}">${escape(label || target)}</span>` }
    if (footnote) token.content = `<span data-writer-footnote="${encode(footnote[1])}"></span>`
  }
  state.pos += match[0].length
  return true
})
let nextId = 0
export type SourceBlock = { raw: string; canonical: string; fingerprint: string }
export interface SourceDocument { prefix: string; blocks: Map<string, SourceBlock> }
export const fingerprint = (node: JSONContent): string => JSON.stringify(node, (key, value) => key === 'sourceId' ? undefined : value)

/** Parse manuscript only. Source spans stay attached to blocks, including original whitespace. */
export function parseManuscript(content: string): { html: string; source: SourceDocument } {
  const source: SourceDocument = { prefix: '', blocks: new Map() }
  let front = ''
  const fm = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (fm) { front = fm[0]; content = content.slice(front.length) }
  const lines = content.split(/(?<=\n)/)
  const starts = [0]
  for (const line of lines) starts.push(starts[starts.length - 1] + line.length)
  const tokens = md.parse(content, {})
  const top = tokens.filter(t => t.level === 0 && t.map && t.nesting !== -1)
  source.prefix = front + content.slice(0, top[0]?.map ? starts[top[0].map![0]] : content.length)
  for (let i = 0; i < top.length; i++) {
    const token = top[i]
    const start = starts[token.map![0]]
    const end = i + 1 < top.length ? starts[top[i + 1].map![0]] : content.length
    const id = `w${++nextId}`
    const raw = content.slice(start, end)
    token.attrSet('data-source-id', id)
    source.blocks.set(id, { raw, canonical: '', fingerprint: '' })
    // The special manuscript nodes remain visible and editable in the rich editor.
    if (token.type === 'html_block' && /<!--\s*pagebreak\s*-->/.test(raw)) {
      token.content = `<div data-writer-pagebreak="true" data-source-id="${id}"></div>`
    } else if (token.type === 'html_block') {
      token.content = token.content.replace(/^(\s*<(?:p|h[1-6]|div|ul|ol|blockquote)\b)/i, `$1 data-source-id="${id}"`)
    }
  }
  const html = md.renderer.render(tokens, md.options, {})
  return { html, source }
}
function decodeHtml(v: string) {
  return v.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
function suggestionHtml(before: string, after: string) {
  return `<span data-writer-suggestion="true" data-before="${encode(decodeHtml(before))}" data-after="${encode(decodeHtml(after))}">${after || before}</span>`
}
export function bindSource(doc: JSONContent, source: SourceDocument) {
  for (const node of doc.content || []) {
    const block = source.blocks.get(node.attrs?.sourceId)
    if (block && !block.fingerprint) { block.fingerprint = fingerprint(node); block.canonical = serializeNode(node) }
  }
}

function inline(nodes: JSONContent[] = []): string {
  return nodes.map(node => {
    const a = node.attrs || {}
    if (node.type === 'hardBreak') return '  \n'
    if (node.type === 'writerComment') return `{>>${a.text || ''}<<}`
    if (node.type === 'writerSuggestion') return a.before && a.after ? `{~~${a.before}~>${a.after}~~}` : a.before ? `{--${a.before}--}` : `{++${a.after || ''}++}`
    if (node.type === 'writerWiki') return `[[${a.target}${a.label ? `|${a.label}` : ''}]]`
    if (node.type === 'writerFootnote') return `[^${a.id}]`
    let text = (node.text || '').replace(/([\\`*_[\]<>])/g, '\\$1')
    if (node.marks?.some(m => m.type === 'code')) return `\`${node.text || ''}\``
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') text = `**${text}**`
      if (mark.type === 'italic') text = `*${text}*`
      if (mark.type === 'strike') text = `~~${text}~~`
      if (mark.type === 'underline') text = `<u>${text}</u>`
      if (mark.type === 'code') text = `\`${text}\``
      if (mark.type === 'link') text = `[${text}](${mark.attrs?.href || ''})`
      if (mark.type === 'highlight') text = `<mark>${text}</mark>`
    }
    return text
  }).join('')
}
export function serializeNode(node: JSONContent): string {
  const a = node.attrs || {}
  let value = ''
  switch (node.type) {
    case 'paragraph': value = inline(node.content); if (/^\[\^[^\]]+\]:/.test(node.content?.[0]?.text || '')) value = value.replace(/^\\\[\^([^\]]+)\\\]:/, '[^$1]:'); break
    case 'heading': value = '#'.repeat(a.level || 1) + ' ' + inline(node.content); break
    case 'blockquote': return (node.content || []).map(n => serializeNode(n).trimEnd().split('\n').map(l => '> ' + l).join('\n')).join('\n>\n') + '\n\n'
    case 'bulletList': case 'orderedList': return (node.content || []).map((item, i) => {
      const body = (item.content || []).map(n => serializeNode(n).trimEnd()).join('\n\n')
      const marker = node.type === 'orderedList' ? `${(a.start || 1) + i}. ` : '- '
      return marker + body.replace(/\n/g, '\n' + ' '.repeat(marker.length))
    }).join('\n') + '\n\n'
    case 'codeBlock': return '```' + (a.language || '') + '\n' + inline(node.content) + '\n```\n\n'
    case 'horizontalRule': return '***\n\n'
    case 'writerPageBreak': return '<!-- pagebreak -->\n\n'
    default: value = inline(node.content)
  }
  if (a.textAlign && a.textAlign !== 'left' || a.indent || a.writerStyle === 'note') {
    const tag = node.type === 'heading' ? `h${a.level || 1}` : 'p'
    const style = [a.textAlign !== 'left' && a.textAlign && `text-align:${a.textAlign}`, a.indent && `margin-left:${a.indent}em`].filter(Boolean).join(';')
    return `<${tag}${style ? ` style="${style}"` : ''}${a.writerStyle === 'note' ? ' data-writer-style="note"' : ''}>${inlineHtml(node.content || [])}</${tag}>\n\n`
  }
  return value + '\n\n'
}
function inlineHtml(nodes: JSONContent[]): string {
  return nodes.map(n => {
    if (n.type !== 'text') return inline([n])
    let text = escape(n.text || '')
    for (const m of n.marks || []) {
      const tag = ({ bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code', highlight: 'mark' } as Record<string, string>)[m.type]
      if (tag) text = `<${tag}>${text}</${tag}>`
      if (m.type === 'link') text = `<a href="${escape(m.attrs?.href || '')}">${text}</a>`
    }
    return text
  }).join('')
}
/** Map a local text edit back into the untouched source spelling and line endings. */
function patchOriginal(raw: string, before: string, after: string): string {
  if (!before || before === after) return raw
  const map: number[] = []
  let sourcePos = 0, canonicalPos = 0
  for (const change of diffChars(raw, before)) {
    if (change.removed) { sourcePos += change.value.length; continue }
    if (change.added) { for (let i = 0; i < change.value.length; i++) map[canonicalPos++] = sourcePos; continue }
    for (let i = 0; i < change.value.length; i++) map[canonicalPos++] = sourcePos++
  }
  map[canonicalPos] = sourcePos
  const edits: { from: number; to: number; text: string }[] = []
  let cursor = 0
  const changes = diffChars(before, after)
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (!change.added && !change.removed) { cursor += change.value.length; continue }
    const start = cursor
    let text = ''
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      if (changes[i].removed) cursor += changes[i].value.length
      if (changes[i].added) text += changes[i].value
      i++
    }
    i--
    edits.push({ from: map[start] ?? raw.length, to: map[cursor] ?? raw.length, text })
  }
  for (const edit of edits.reverse()) raw = raw.slice(0, edit.from) + edit.text + raw.slice(edit.to)
  return raw
}
export function serializeManuscript(doc: JSONContent, source: SourceDocument): string {
  if (!source.blocks.size && doc.content?.length === 1 && doc.content[0].type === 'paragraph' && !doc.content[0].content?.length) return source.prefix
  const used = new Set<string>()
  return source.prefix + (doc.content || []).map(node => {
    const id = node.attrs?.sourceId
    const old = id && !used.has(id) ? source.blocks.get(id) : undefined
    used.add(id)
    if (old?.fingerprint === fingerprint(node)) return old.raw
    const next = serializeNode(node)
    if (!old) return next
    const previous: JSONContent = JSON.parse(old.fingerprint || '{}')
    // A formatting command deliberately changes syntax; text revisions patch individual spans.
    const sameStructure = previous.type === node.type && JSON.stringify(previous.attrs || {}) === JSON.stringify(Object.fromEntries(Object.entries(node.attrs || {}).filter(([key]) => key !== 'sourceId')))
    if (!sameStructure || plainText({ type: 'doc', content: [previous] }) === plainText({ type: 'doc', content: [node] })) return next
    return patchOriginal(old.raw, old.canonical, next)
  }).join('')
}
export const wordCount = (value: string) => (value.replace(/^\[\^[^\]\n]+\]:[^\n]*(?:\n|$)/gm, '').replace(/\{>>[\s\S]*?<<\}/g, '').replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$2').replace(/\{--[\s\S]*?--\}/g, '').replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1').replace(/<!--[^]*?-->/g, '').match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) || []).length

export function plainText(doc: JSONContent): string {
  const text = (node: JSONContent): string => node.text || (node.type === 'hardBreak' ? '\n' : node.type === 'writerWiki' ? node.attrs?.label || node.attrs?.target || '' : node.type === 'writerSuggestion' ? node.attrs?.after || '' : (node.content || []).map(text).join(node.type === 'doc' ? '\n\n' : ''))
  return text(doc)
}
