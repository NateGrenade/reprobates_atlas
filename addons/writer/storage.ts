import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import MarkdownIt from 'markdown-it'
import { parse, HTMLElement, TextNode, type Node } from 'node-html-parser'

const markdown = new MarkdownIt({ html: true })
const words = (content: string) => {
  const text = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/\{>>[\s\S]*?<<\}/g, '').replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$2')
    .replace(/\{--[\s\S]*?--\}/g, '').replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/^\[\^[^\]\n]+\]:[^\n]*(?:\n|$)/gm, '').replace(/\[\^[^\]\n]+\]/g, '')
    .replace(/<!--[^]*?-->/g, '')
  const visible = (nodes: Node[]): string => nodes.map(node => {
    if (node instanceof TextNode) return node.text
    if (!(node instanceof HTMLElement)) return ''
    const value = visible(node.childNodes)
    return /^(?:p|h[1-6]|li|ul|ol|blockquote|pre|br|hr)$/i.test(node.tagName) ? ` ${value} ` : value
  }).join('')
  return (visible(parse(markdown.render(text)).childNodes).match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length
}
const name = (value: string) => {
  const s = value.trim()
  if (!s || s === '.' || s === '..' || /[/\\\0]/.test(s)) throw new Error('Invalid book or chapter name')
  return s
}

export class WriterStorage {
  private root: string
  private data: string
  constructor(root: string, dataDir: string, private recordWrite: (...paths: string[]) => void = () => {}) {
    this.root = realpathSync(root)
    this.data = join(dataDir, createHash('sha256').update(this.root).digest('hex'))
    mkdirSync(this.data, { recursive: true })
  }
  private file(path: string, createDirs = false): string {
    const parts = path.split('/')
    if (parts.length !== 3 || parts[0] !== 'Manuscript' || !parts[2].endsWith('.md')) throw new Error('Invalid manuscript path')
    name(parts[1]); name(parts[2].slice(0, -3))
    let current = this.root
    for (const part of parts.slice(0, 2)) {
      current = join(current, part)
      if (!existsSync(current) && createDirs) mkdirSync(current)
      if (existsSync(current) && (lstatSync(current).isSymbolicLink() || !lstatSync(current).isDirectory())) throw new Error('Invalid manuscript folder')
    }
    const file = resolve(this.root, ...parts)
    if (!file.startsWith(this.root + sep) || (existsSync(file) && lstatSync(file).isSymbolicLink())) throw new Error('Invalid manuscript path')
    return file
  }
  read(path: string) { return { path, content: readFileSync(this.file(path), 'utf8') } }
  save({ path, content, original }: { path: string; content: string; original: string }) {
    const file = this.file(path)
    if (readFileSync(file, 'utf8') !== original) throw new Error('This chapter changed on disk. Reopen it before saving.')
    writeFileSync(file, content, 'utf8')
    this.recordWrite(path)
    return { path, content }
  }
  create({ book, title }: { book: string; title: string }) {
    const path = `Manuscript/${name(book)}/${name(title)}.md`
    writeFileSync(this.file(path, true), '', { encoding: 'utf8', flag: 'wx' })
    this.recordWrite(path)
    return { path, content: '' }
  }
  importChapter(book: string, title: string, content: string) {
    const path = `Manuscript/${name(book)}/${name(title)}.md`
    writeFileSync(this.file(path, true), content, { encoding: 'utf8', flag: 'wx' })
    this.recordWrite(path)
    return { path, content }
  }
  rename({ path, title }: { path: string; title: string }) {
    const source = this.file(path)
    const target = `${path.slice(0, path.lastIndexOf('/') + 1)}${name(title)}.md`
    const dest = this.file(target)
    if (existsSync(dest)) throw new Error('A chapter with that name already exists')
    const oldSnapshots = this.snapshotDir(path), newSnapshots = this.snapshotDir(target)
    renameSync(source, dest)
    this.recordWrite(path, target)
    if (existsSync(oldSnapshots)) renameSync(oldSnapshots, newSnapshots)
    const settingsFile = join(this.data, 'settings.json')
    const settings = this.readJson(settingsFile, {})
    if (settings[path]) { settings[target] = settings[path]; delete settings[path]; this.writeJson(settingsFile, settings) }
    const orderFile = join(this.data, 'order.json')
    const order = this.readJson(orderFile, {})
    const book = path.split('/')[1]
    if (order[book]) { order[book] = order[book].map((p: string) => p === path ? target : p); this.writeJson(orderFile, order) }
    return { path: target, content: readFileSync(dest, 'utf8') }
  }
  private readJson(file: string, fallback: any) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback }
  private writeJson(file: string, value: unknown) { writeFileSync(file, JSON.stringify(value, null, 2)) }
  settings(path: string) { this.file(path); return this.readJson(join(this.data, 'settings.json'), {})[path] ?? {} }
  saveSettings({ path, settings }: { path: string; settings: unknown }) {
    this.file(path)
    const file = join(this.data, 'settings.json'), all = this.readJson(file, {})
    all[path] = settings
    this.writeJson(file, all)
    return settings
  }
  reorder({ book, paths }: { book: string; paths: string[] }) {
    name(book)
    for (const path of paths) { this.file(path); if (!path.startsWith(`Manuscript/${book}/`)) throw new Error('Chapter is outside this book') }
    const file = join(this.data, 'order.json')
    const order = this.readJson(file, {})
    order[book] = paths
    this.writeJson(file, order)
  }
  list() {
    const dir = join(this.root, 'Manuscript')
    if (!existsSync(dir)) return { books: [] }
    if (lstatSync(dir).isSymbolicLink()) throw new Error('Invalid manuscript folder')
    const order = this.readJson(join(this.data, 'order.json'), {})
    return { books: readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).sort((a,b) => a.name.localeCompare(b.name)).map(d => {
      const chapters = readdirSync(join(dir, d.name), { withFileTypes: true }).filter(f => f.isFile() && f.name.endsWith('.md')).map(f => {
        const path = `Manuscript/${d.name}/${f.name}`
        return { path, title: basename(f.name, '.md'), words: words(readFileSync(this.file(path), 'utf8')) }
      })
      const ranked: string[] = order[d.name] ?? []
      chapters.sort((a,b) => { const ai = ranked.indexOf(a.path), bi = ranked.indexOf(b.path); return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.title.localeCompare(b.title) })
      return { name: d.name, chapters }
    }) }
  }
  private snapshotDir(path: string) {
    this.file(path)
    return join(this.data, 'snapshots', createHash('sha256').update(path).digest('hex'))
  }
  snapshot({ path, content }: { path: string; content: string }) {
    const dir = this.snapshotDir(path); mkdirSync(dir, { recursive: true })
    const id = `${Date.now()}-${randomUUID()}`
    writeFileSync(join(dir, `${id}.md`), content, { encoding: 'utf8', flag: 'wx' })
    return { id, created: new Date(Number(id.split('-')[0])).toISOString(), words: words(content) }
  }
  snapshots(path: string) {
    const dir = this.snapshotDir(path)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => ({ id: f.slice(0, -3), created: new Date(Number(f.split('-')[0])).toISOString(), words: words(readFileSync(join(dir, f), 'utf8')) })).sort((a,b) => b.created.localeCompare(a.created))
  }
  snapshotRead({ path, id }: { path: string; id: string }) {
    if (!/^\d+-[0-9a-f-]+$/.test(id)) throw new Error('Invalid snapshot')
    return { content: readFileSync(join(this.snapshotDir(path), `${id}.md`), 'utf8') }
  }
}
