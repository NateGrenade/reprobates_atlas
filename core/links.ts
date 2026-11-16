// Wikilink parsing and Obsidian-style resolution (basename or path, case-insensitive; headings).

export interface WikiLink {
  raw: string
  target: string // note path or name, without .md, may be '' for same-note heading links
  heading?: string
  alias?: string
  embed: boolean
  /** offset in the scanned text */
  index: number
}

const LINK_RE = /(!?)\[\[([^\[\]\n|#]*)(?:#([^\[\]\n|]*))?(?:\|([^\[\]\n]*))?\]\]/g

/** Parse a single wikilink string such as "[[Supporting Cast#Chara|Chara]]". Returns null if not a wikilink. */
export function parseLink(s: string): WikiLink | null {
  if (typeof s !== 'string') return null
  const m = /^\s*(!?)\[\[([^\[\]\n|#]*)(?:#([^\[\]\n|]*))?(?:\|([^\[\]\n]*))?\]\]\s*$/.exec(s)
  if (!m) return null
  return mk(m, 0)
}

function mk(m: RegExpExecArray, index: number): WikiLink {
  return {
    raw: m[0].trim(),
    embed: m[1] === '!',
    target: m[2].trim().replace(/\.md$/i, ''),
    heading: m[3]?.trim() || undefined,
    alias: m[4]?.trim() || undefined,
    index
  }
}

/** Blank out fenced code blocks and inline code so links inside them are ignored (lengths preserved). */
export function maskCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  let t = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, blank)
  t = t.replace(/`[^`\n]+`/g, blank)
  return t
}

/** All wikilinks in a markdown body, ignoring code. */
export function findLinks(text: string): WikiLink[] {
  const masked = maskCode(text)
  const out: WikiLink[] = []
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(masked))) {
    // read from the original text so the raw matches
    const orig = text.slice(m.index, m.index + m[0].length)
    const om = new RegExp(LINK_RE.source).exec(orig)
    if (om) out.push(mk(om, m.index))
  }
  return out
}

export const normHeading = (h: string) => h.trim().replace(/\s+/g, ' ').toLowerCase()

/** Resolves link targets against a set of vault file paths (vault-relative, '/' separated). */
export class LinkResolver {
  private byPath = new Map<string, string>()
  private byName = new Map<string, string[]>()

  constructor(paths: Iterable<string>) {
    for (const p of paths) this.add(p)
  }

  add(path: string) {
    const noExt = path.replace(/\.md$/i, '')
    this.byPath.set(noExt.toLowerCase(), path)
    this.byPath.set(path.toLowerCase(), path)
    const base = noExt.split('/').pop()!.toLowerCase()
    const baseExt = path.split('/').pop()!.toLowerCase()
    for (const key of new Set([base, baseExt])) {
      const arr = this.byName.get(key) ?? []
      if (!arr.includes(path)) arr.push(path)
      arr.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))
      this.byName.set(key, arr)
    }
  }

  /** Resolve a target (as written in a link) to a vault path, or null. `from` is the linking note's path. */
  resolve(target: string, from?: string): string | null {
    if (!target) return from ?? null
    const t = target.replace(/^\/+/, '').toLowerCase()
    const direct = this.byPath.get(t)
    if (direct) return direct
    if (from && target.startsWith('.')) {
      const dir = from.split('/').slice(0, -1)
      for (const seg of target.split('/')) {
        if (seg === '..') dir.pop()
        else if (seg !== '.') dir.push(seg)
      }
      const rel = this.byPath.get(dir.join('/').toLowerCase())
      if (rel) return rel
    }
    if (t.includes('/')) {
      // partial path suffix match
      for (const [k, v] of this.byPath) if (k.endsWith('/' + t)) return v
      return null
    }
    const cands = this.byName.get(t)
    if (!cands || cands.length === 0) return null
    if (cands.length > 1 && from) {
      const dir = from.split('/').slice(0, -1).join('/')
      const same = cands.find((c) => c.split('/').slice(0, -1).join('/') === dir)
      if (same) return same
    }
    return cands[0]
  }
}
