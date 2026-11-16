import mammoth from 'mammoth'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { parse, HTMLElement, TextNode, type Node } from 'node-html-parser'
import { Document, ExternalHyperlink, Footer, Header, Packer, PageNumber, Paragraph, TextRun, AlignmentType, PageBreak, FootnoteReferenceRun } from 'docx'
import { basename } from 'node:path'
import type { WriterSettings } from './types'

const markdown = new MarkdownIt({ html: true })
export async function importDocx(path: string): Promise<string> {
  const preserveBreaks = (node: any): any => {
    if (node.type === 'break' && node.breakType === 'page') return { type: 'text', value: ' ATLASWRITERPAGEBREAKMARKER ' }
    return node.children ? { ...node, children: node.children.map(preserveBreaks) } : node
  }
  const result = await mammoth.convertToHtml({ path }, { transformDocument: preserveBreaks })
  const safe = sanitizeHtml(result.value, { allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 's', 'u', 'a', 'br', 'ul', 'ol', 'li', 'blockquote'], allowedAttributes: { a: ['href'] }, allowedSchemes: ['http', 'https', 'mailto'] })
  const text = (value: string) => value.replace(/&/g, '&amp;').replace(/[\\*_[\]<>`~]/g, '\\$&')
  const inlineImport = (nodes: Node[]): string => nodes.map(node => {
    if (node instanceof TextNode) return text(node.text)
    if (!(node instanceof HTMLElement)) return ''
    const tag = node.tagName.toLowerCase(), body = inlineImport(node.childNodes)
    if (tag === 'br') return '  \n'
    if (['em', 'strong', 's', 'u'].includes(tag)) return `<${tag}>${body}</${tag}>`
    if (tag === 'a' && node.getAttribute('href')) return `<a href="${escape(node.getAttribute('href')!)}">${body}</a>`
    return body
  }).join('')
  const blocks = (nodes: Node[], depth = 0): string => nodes.map(node => {
    if (!(node instanceof HTMLElement)) return ''
    const tag = node.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') return node.childNodes.map((item, index) => item instanceof HTMLElement && item.tagName.toLowerCase() === 'li' ? `${'  '.repeat(depth)}${tag === 'ol' ? `${index + 1}.` : '-'} ${inlineImport(item.childNodes)}\n` : '').join('') + '\n'
    if (tag === 'blockquote') return blocks(node.childNodes, depth).trimEnd().split('\n').map(line => `> ${line}`).join('\n') + '\n\n'
    const body = inlineImport(node.childNodes)
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${body}\n\n`
    if (tag === 'p') {
      if (/^\s*(?:\\\*[ \t]*){3,}\s*$/.test(body)) return '* * *\n\n'
      return body.replace(/^([ \t]*)(#{1,6}|>|[-+]|\d+\.)(?=[ \t])/gm, '$1\\$2') + '\n\n'
    }
    return blocks(node.childNodes, depth)
  }).join('')
  return blocks(parse(safe).childNodes).replace(/ ?ATLASWRITERPAGEBREAKMARKER ?/g, '\n\n<!-- pagebreak -->\n\n')
}

/** Export the accepted reading of suggestions; comments and deleted text remain in the source. */
function exportHtml(content: string, footnotes: Map<string, string>, includeNotes: boolean): string {
  content = content.replace(/^\[\^([^\]\n]+)\]:[ \t]*(.*)$/gm, (_, id, text) => { footnotes.set(id, text); return '' })
  const accepted = content.replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$2')
    .replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1').replace(/\{--[\s\S]*?--\}/g, '')
    .replace(/\{>>[\s\S]*?<<\}/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/<!--\s*pagebreak\s*-->/gi, '\n<div data-page-break="true"></div>\n')
    .replace(/\[\^([^\]\n]+)\]/g, (match, id) => footnotes.has(id) ? `<sup data-footnote="${escape(id)}"><a href="#note-${escape(id)}">[${escape(id)}]</a></sup>` : match)
  const rendered = markdown.render(accepted) + (includeNotes && footnotes.size ? '<hr><ol>' + [...footnotes].map(([id, text]) => `<li id="note-${escape(id)}">${markdown.renderInline(text)}</li>`).join('') + '</ol>' : '')
  return sanitizeHtml(rendered, {
    allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 's', 'del', 'u', 'mark', 'code', 'pre', 'a', 'br', 'hr', 'blockquote', 'ul', 'ol', 'li', 'div', 'sup'],
    allowedAttributes: { p: ['style'], h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'], a: ['href'], div: ['data-page-break'], ol: ['start'], sup: ['data-footnote'], li: ['id'] },
    allowedStyles: { '*': { 'text-align': [/^(?:left|right|center|justify)$/], 'margin-left': [/^\d+(?:\.\d+)?em$/] } },
    allowedSchemes: ['http', 'https', 'mailto']
  })
}
const twips = (inches: number) => Math.round(inches * 1440)
type RunStyle = { bold?: boolean; italics?: boolean; strike?: boolean; underline?: {}; highlight?: 'yellow'; font?: string }
function inline(nodes: Node[], footnotes: Map<string, string>, style: RunStyle = {}): (TextRun | ExternalHyperlink | FootnoteReferenceRun)[] {
  const result: (TextRun | ExternalHyperlink | FootnoteReferenceRun)[] = []
  for (const node of nodes) {
    if (node instanceof TextNode) { if (node.text) result.push(new TextRun({ text: node.text, ...style })); continue }
    if (!(node instanceof HTMLElement)) continue
    const tag = node.tagName.toLowerCase()
    if (tag === 'sup' && node.getAttribute('data-footnote')) {
      const note = footnotes.get(node.getAttribute('data-footnote')!)
      if (note !== undefined) result.push(new FootnoteReferenceRun({ children: [new Paragraph(note)] }))
      continue
    }
    if (tag === 'br') { result.push(new TextRun({ break: 1 })); continue }
    const next: RunStyle = { ...style, ...(tag === 'em' ? { italics: true } : {}), ...(tag === 'strong' ? { bold: true } : {}), ...(['s', 'del'].includes(tag) ? { strike: true } : {}), ...(tag === 'u' ? { underline: {} } : {}), ...(tag === 'mark' ? { highlight: 'yellow' as const } : {}), ...(tag === 'code' ? { font: 'Courier New' } : {}) }
    const runs = inline(node.childNodes, footnotes, next)
    if (tag === 'a' && node.getAttribute('href')) result.push(new ExternalHyperlink({ link: node.getAttribute('href')!, children: runs.filter((r): r is TextRun => r instanceof TextRun) }))
    else result.push(...runs)
  }
  return result
}
export async function exportDocx(content: string, settings: WriterSettings, _title: string): Promise<Buffer> {
  const children: Paragraph[] = []
  const footnotes = new Map<string, string>()
  const html = exportHtml(content, footnotes, false)
  const add = (node: HTMLElement, prefix = '', level = 0) => {
    const tag = node.tagName.toLowerCase()
    if (tag === 'div' && node.hasAttribute('data-page-break')) { children.push(new Paragraph({ children: [new PageBreak()] })); return }
    if (tag === 'hr') { children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('* * *')] })); return }
    if (tag === 'ul' || tag === 'ol') {
      let index = Number(node.getAttribute('start') ?? 1)
      for (const li of node.childNodes) if (li instanceof HTMLElement && li.tagName.toLowerCase() === 'li') {
        const marker = tag === 'ol' ? `${index++}. ` : '• '
        const blocks = li.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement && ['p', 'ul', 'ol'].includes(n.tagName.toLowerCase()))
        if (blocks.length) { let first = true; for (const block of blocks) { add(block, first && block.tagName.toLowerCase() === 'p' ? marker : '', level + 1); first = false } }
        else add(li, marker, level + 1)
      }
      return
    }
    if (tag === 'blockquote') { for (const child of node.childNodes) if (child instanceof HTMLElement) add(child, '', level + 1); return }
    if (!['p', 'li', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return
    const css = node.getAttribute('style') ?? ''
    const align = /text-align:\s*(left|right|center|justify)/.exec(css)?.[1]
    const indent = Number(/margin-left:\s*(\d+(?:\.\d+)?)em/.exec(css)?.[1] ?? 0)
    const heading = /^h([1-6])$/.exec(tag)?.[1]
    children.push(new Paragraph({ children: [...(prefix ? [new TextRun(prefix)] : []), ...inline(node.childNodes, footnotes)], heading: heading ? (`Heading${heading}` as any) : undefined, alignment: align ? ({ left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED } as const)[align as 'left' | 'right' | 'center' | 'justify'] : undefined, indent: { left: Math.round((indent * (settings.fontSize ?? 17) / 96 + level * 0.25) * 1440), ...(!heading && !prefix ? { firstLine: twips((settings.firstLineIndent ?? 0) / 96) } : {}) }, spacing: { line: Math.round((settings.lineSpacing ?? 2) * 240) } }))
  }
  for (const node of parse(html).childNodes) if (node instanceof HTMLElement) add(node)
  const margin = (settings.margin ?? 72) / 96
  const width = settings.pageSize === 'a4' ? 8.27 : 8.5, height = settings.pageSize === 'a4' ? 11.69 : 11
  const header = settings.header ? new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(settings.header)] })] }) : undefined
  const footer = settings.pageNumbers ? new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) : undefined
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: settings.font ?? 'Times New Roman', size: Math.round((settings.fontSize ?? 17) * 1.5) } } } }, sections: [{ properties: { page: { size: { width: twips(width), height: twips(height) }, margin: { top: twips(margin), bottom: twips(margin), left: twips(margin), right: twips(margin) } } }, headers: header ? { default: header } : undefined, footers: footer ? { default: footer } : undefined, children }] }))
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export function pdfHtml(content: string, settings: WriterSettings, fontFaces = ""): string {
  const margin = (settings.margin ?? 72) / 96
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaces}
    body { font-family: ${JSON.stringify(settings.font ?? 'Times New Roman')}, serif; font-size: ${Number(settings.fontSize ?? 17)}px; line-height: ${Number(settings.lineSpacing ?? 2)}; color: #111; }
    p { text-indent: ${Number((settings.firstLineIndent ?? 0) / 96)}in; margin: 0; } li p { text-indent: 0 } h1,h2,h3 { break-after: avoid; } hr { border: 0; text-align: center; margin: 1em 0; } hr:after { content: '* * *'; } [data-page-break] { break-after: page; }
    @page { size: ${settings.pageSize === 'a4' ? 'A4' : 'letter'}; margin: ${margin}in; }
  </style></head><body>${exportHtml(content, new Map(), true)}</body></html>`
}
export function pdfOptions(settings: WriterSettings) {
  return { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: Boolean(settings.header || settings.pageNumbers), headerTemplate: `<div style="font-size:9px;width:100%;text-align:right;margin:0 1in">${escape(String(settings.header ?? ''))}</div>`, footerTemplate: settings.pageNumbers ? '<div style="font-size:9px;width:100%;text-align:right;margin:0 1in"><span class="pageNumber"></span></div>' : '<div></div>' }
}
export function importTitle(path: string) { return basename(path).replace(/\.docx$/i, '') }
