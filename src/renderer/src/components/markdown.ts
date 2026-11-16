// Markdown -> HTML for reading views. Raw HTML in notes is escaped (html: false).
import MarkdownIt from 'markdown-it'
import type { VaultIndex } from '@core/vault'
import { vaultUrl } from '../store'

const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i

export function renderMarkdown(src: string, ix: VaultIndex | null, from?: string): string {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const s = state.src
    const start = state.pos
    const embed = s.charCodeAt(start) === 0x21 /* ! */
    const open = embed ? start + 1 : start
    if (s.slice(open, open + 2) !== '[[') return false
    const close = s.indexOf(']]', open + 2)
    if (close < 0) return false
    const inner = s.slice(open + 2, close)
    if (inner.includes('\n') || inner.includes('[')) return false
    if (!silent) {
      const [targetPart, alias] = inner.split('|')
      const [target, heading] = targetPart.split('#')
      const path = ix?.resolver.resolve(target.trim(), from) ?? (target.trim() === '' ? from ?? null : null)
      if (embed && path && IMG.test(path)) {
        const t = state.push('html_inline', '', 0)
        t.content = `<img class="embed" src="${vaultUrl(path)}" alt="${md.utils.escapeHtml(alias ?? target)}">`
      } else {
        const label = alias ?? (heading ? (target ? `${target} › ${heading}` : heading) : target)
        const t = state.push('html_inline', '', 0)
        t.content = `<a class="wikilink${path ? '' : ' unresolved'}" data-path="${md.utils.escapeHtml(path ?? '')}" data-heading="${md.utils.escapeHtml(heading ?? '')}" data-target="${md.utils.escapeHtml(target)}">${md.utils.escapeHtml(label.trim())}</a>`
      }
    }
    state.pos = close + 2
    return true
  })
  return md.render(src)
}
