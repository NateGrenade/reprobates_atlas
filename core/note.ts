// Note text <-> parts, frontmatter read and in-place patch.
// Round-trip rule (contract 9): never re-stringify YAML; patches splice only the target key's span.
import { LineCounter, parseDocument, isMap, isScalar, type Pair, type Node } from 'yaml'

export interface NoteParts {
  bom: string
  /** Full frontmatter block including both `---` lines and the closing line break, or '' */
  fmBlock: string
  /** YAML text between the delimiters (no delimiter lines) */
  fmInner: string
  /** Offset of fmInner within the full text */
  fmInnerOffset: number
  body: string
  eol: '\n' | '\r\n'
}

const FM_RE = /^---[ \t]*(\r?\n)([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/
const EMPTY_FM_RE = /^---[ \t]*(\r?\n)---[ \t]*(\r?\n|$)/

export function splitNote(text: string): NoteParts {
  const bom = text.startsWith('﻿') ? '﻿' : ''
  const rest = text.slice(bom.length)
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const empty = EMPTY_FM_RE.exec(rest)
  if (empty) {
    const innerStart = empty[0].indexOf(empty[1]) + empty[1].length
    return { bom, fmBlock: empty[0], fmInner: '', fmInnerOffset: bom.length + innerStart, body: rest.slice(empty[0].length), eol }
  }
  const m = FM_RE.exec(rest)
  if (!m) return { bom, fmBlock: '', fmInner: '', fmInnerOffset: -1, body: rest, eol }
  const innerStart = m[0].indexOf(m[1]) + m[1].length
  const fmInner = m[2]
  return {
    bom,
    fmBlock: m[0],
    fmInner,
    fmInnerOffset: bom.length + innerStart,
    body: rest.slice(m[0].length),
    eol
  }
}

export function joinNote(p: NoteParts): string {
  return p.bom + p.fmBlock + p.body
}

export interface Frontmatter {
  data: Record<string, unknown>
  /** 1-based line number in the full file for each top-level key */
  keyLines: Record<string, number>
  /** YAML parse errors with 1-based file line */
  errors: { line: number; message: string }[]
  /** 1-based line where the frontmatter starts (the opening ---), 0 if none */
  startLine: number
}

export function readFrontmatter(text: string): Frontmatter {
  const p = splitNote(text)
  const out: Frontmatter = { data: {}, keyLines: {}, errors: [], startLine: 0 }
  if (!p.fmBlock) return out
  out.startLine = 1
  const lc = new LineCounter()
  const doc = parseDocument(p.fmInner, { lineCounter: lc, uniqueKeys: false })
  // inner text starts on file line 2
  for (const e of doc.errors) out.errors.push({ line: (e.linePos?.[0].line ?? 1) + 1, message: e.message })
  if (doc.errors.length) return out
  const js = doc.toJS()
  if (js && typeof js === 'object' && !Array.isArray(js)) out.data = js
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items as Pair<Node, Node>[]) {
      if (isScalar(pair.key) && pair.key.range) {
        out.keyLines[String(pair.key.value)] = lc.linePos(pair.key.range[0]).line + 1
      }
    }
  }
  return out
}

const PLAIN_SAFE = /^[A-Za-z_][A-Za-z0-9 _./-]*$/
const YAML_WORDS = /^(true|false|yes|no|on|off|null|~|y|n)$/i

/** Serialize a value as a one-line YAML value. Wikilinks and anything ambiguous are double-quoted. */
export function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return '[' + v.map(yamlValue).join(', ') + ']'
  if (typeof v === 'object') {
    return '{' + Object.entries(v as Record<string, unknown>).map(([k, x]) => `${yamlKey(k)}: ${yamlValue(x)}`).join(', ') + '}'
  }
  const s = String(v)
  if (PLAIN_SAFE.test(s) && !YAML_WORDS.test(s) && s.trim() === s) return s
  return JSON.stringify(s)
}

function yamlKey(k: string): string {
  return PLAIN_SAFE.test(k) && !YAML_WORDS.test(k) ? k : JSON.stringify(k)
}

/**
 * Set (or remove, when value === undefined) one top-level frontmatter key, editing only that key's text.
 * Every other byte of the file is preserved.
 */
export function patchFrontmatter(text: string, key: string, value: unknown): string {
  const p = splitNote(text)
  const line = `${yamlKey(key)}: ${yamlValue(value)}`
  if (!p.fmBlock) {
    if (value === undefined) return text
    return p.bom + `---${p.eol}${line}${p.eol}---${p.eol}` + p.body
  }
  const doc = parseDocument(p.fmInner, { uniqueKeys: false })
  if (doc.errors.length) throw new Error(`Cannot patch frontmatter with YAML errors: ${doc.errors[0].message}`)
  let pair: Pair<Node, Node> | undefined
  if (isMap(doc.contents)) {
    pair = (doc.contents.items as Pair<Node, Node>[]).find((it) => isScalar(it.key) && String(it.key.value) === key)
  } else if (doc.contents && p.fmInner.trim() !== '') {
    throw new Error('Frontmatter is not a key/value map')
  }
  const inner = p.fmInner
  let newInner: string
  if (pair && pair.key && pair.key.range) {
    const start = pair.key.range[0]
    let end: number
    if (pair.value && pair.value.range) end = pair.value.range[1]
    else {
      const nl = inner.indexOf('\n', start)
      end = nl === -1 ? inner.length : nl
    }
    // Do not swallow the line break if the value's range ends right after it
    while (end > start && (inner[end - 1] === '\n' || inner[end - 1] === '\r')) end--
    if (value === undefined) {
      // remove whole lines from start-of-line to end incl. trailing break
      const ls = inner.lastIndexOf('\n', start - 1) + 1
      let le = end
      if (inner.startsWith('\r\n', le)) le += 2
      else if (inner[le] === '\n') le += 1
      newInner = inner.slice(0, ls) + inner.slice(le)
      if (le >= inner.length) newInner = newInner.replace(/\r?\n$/, '')
    } else {
      newInner = inner.slice(0, start) + line + inner.slice(end)
    }
  } else {
    if (value === undefined) return text
    if (inner === '') newInner = line
    else newInner = inner + (inner.endsWith('\n') ? '' : p.eol) + line
  }
  // Rebuild the block: opening line + inner + closing part
  const open = p.fmBlock.slice(0, p.fmInnerOffset - p.bom.length)
  const close = p.fmBlock.slice(p.fmInnerOffset - p.bom.length + inner.length)
  let closeFixed = close
  // When inner was empty, the regex consumed "---\n---"; ensure a line break between new inner and closing ---
  if (inner === '' && !/^\r?\n/.test(close)) closeFixed = p.eol + close
  if (newInner === '' && inner !== '') {
    // keep the block valid: "---\n---"
    closeFixed = close.replace(/^\r?\n/, '')
  }
  return p.bom + open + newInner + closeFixed + p.body
}

/** Patch several keys in order. */
export function patchFrontmatterMany(text: string, patch: Record<string, unknown>): string {
  let t = text
  for (const [k, v] of Object.entries(patch)) t = patchFrontmatter(t, k, v)
  return t
}
