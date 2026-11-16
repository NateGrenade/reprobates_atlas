// Link-safe rename/move: rewrite every wikilink that resolves to `from` so it points at `to`.
// Only the link target text changes; headings, aliases and every other byte stay.
import { findLinks, LinkResolver } from './links'

export interface LinkEdit { path: string; text: string; count: number }

export function relinkFor(files: Map<string, string | null>, from: string, to: string): LinkEdit[] {
  const resolver = new LinkResolver(files.keys())
  // a bare name is used only if no other file shares the new base name (Obsidian would call it ambiguous)
  const toNoExt = to.replace(/\.md$/i, '')
  const toBase = toNoExt.split('/').pop()!
  const out: LinkEdit[] = []
  for (const [path, text] of files) {
    if (typeof text !== 'string' || !path.toLowerCase().endsWith('.md')) continue
    const links = findLinks(text).filter((l) => l.target && resolver.resolve(l.target, path) === from)
    if (!links.length) continue
    let next = text
    // splice from the end so earlier offsets stay valid
    for (const l of [...links].sort((a, b) => b.index - a.index)) {
      const start = l.index + (l.embed ? 1 : 0) + 2
      const raw = text.slice(start, start + text.slice(start).search(/[#|\]]/))
      const usesPath = raw.includes('/')
      const ext = /\.md$/i.test(raw.trim()) ? '.md' : ''
      const bareOk = ![...files.keys()].some((p) => p !== from && p.replace(/\.md$/i, '').split('/').pop()!.toLowerCase() === toBase.toLowerCase())
      const replacement = (usesPath || !bareOk ? toNoExt : toBase) + ext
      next = next.slice(0, start) + replacement + next.slice(start + raw.length)
    }
    if (next !== text) out.push({ path, text: next, count: links.length })
  }
  return out
}
