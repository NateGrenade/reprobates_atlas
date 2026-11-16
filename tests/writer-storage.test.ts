import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import MarkdownIt from 'markdown-it'
import { parse } from 'node-html-parser'
import { WriterStorage } from '../addons/writer/storage'
import { exportDocx, importDocx, pdfHtml } from '../addons/writer/io'
import { DEFAULT_SETTINGS } from '../addons/writer/types'

const dirs: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-writer-')); dirs.push(root)
  mkdirSync(join(root, 'vault')); mkdirSync(join(root, 'data'))
  return { root, vault: join(root, 'vault'), store: new WriterStorage(join(root, 'vault'), join(root, 'data')) }
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
describe('writer storage', () => {
  it('preserves exact chapter content and rejects external edits', () => {
    const { vault, store } = fixture()
    const doc = store.create({ book: 'Book', title: 'One' })
    const content = '# Chapter\r\n\r\nA *word* {++new++}.\r\n'
    store.save({ path: doc.path, content, original: '' })
    expect(store.read(doc.path).content).toBe(content)
    writeFileSync(join(vault, doc.path), 'external')
    expect(() => store.save({ path: doc.path, content: 'mine', original: content })).toThrow(/changed on disk/)
    expect(readFileSync(join(vault, doc.path), 'utf8')).toBe('external')
  })
  it('restricts writes to manuscript chapters and rejects symlink escapes', () => {
    const { root, vault, store } = fixture()
    expect(() => store.create({ book: '..', title: 'x' })).toThrow()
    expect(() => store.read('Lore/file.md')).toThrow()
    mkdirSync(join(vault, 'Manuscript'))
    symlinkSync(root, join(vault, 'Manuscript', 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => store.create({ book: 'outside', title: 'escape' })).toThrow()
  })
  it('lists chapters in chosen order and saves independent snapshots', () => {
    const { store } = fixture()
    const a = store.create({ book: 'Book', title: 'A' }), b = store.create({ book: 'Book', title: 'B' })
    store.save({ path: a.path, original: '', content: 'One two' })
    store.reorder({ book: 'Book', paths: [b.path, a.path] })
    expect(store.list().books[0].chapters.map(c => [c.title, c.words])).toEqual([['B', 0], ['A', 2]])
    const snapshot = store.snapshot({ path: a.path, content: 'Earlier text' })
    expect(store.snapshots(a.path)[0].id).toBe(snapshot.id)
    expect(store.snapshotRead({ path: a.path, id: snapshot.id }).content).toBe('Earlier text')
    expect(store.read(a.path).content).toBe('One two')
  })
  it('round-trips Word headings and emphasis and renders scene breaks', async () => {
    const { root } = fixture()
    const source = join(root, 'chapter.docx')
    writeFileSync(source, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ text: 'Chapter One', heading: HeadingLevel.HEADING_1 }), new Paragraph({ children: [new TextRun('A '), new TextRun({ text: ' quiet ', italics: true }), new TextRun(' place.')] }), new Paragraph('* * *'), new Paragraph({ children: [new PageBreak()] })] }] })))
    const imported = await importDocx(source)
    expect(imported).toMatch(/# Chapter One/)
    expect(imported).toContain('<em> quiet </em>')
    expect(parse(new MarkdownIt({ html: true }).render(imported)).querySelector('em')?.text).toBe(' quiet ')
    expect(imported).toContain('* * *')
    expect(imported).toContain('<!-- pagebreak -->')
    const exported = join(root, 'export.docx')
    writeFileSync(exported, await exportDocx(imported, DEFAULT_SETTINGS, 'Chapter'))
    expect(await importDocx(exported)).toContain('<em> quiet </em>')
    expect(pdfHtml(imported, DEFAULT_SETTINGS)).toContain('<hr')
  })
  it('exports formatted chapters with safe HTML, page breaks, headers and page numbers', async () => {
    const source = '# Heading\n\n<p style="text-align:center;margin-left:2em"><u>Under</u> <s>strike</s> <a href="https://example.com">link</a></p>\n\n- first\n- second\n\n<!-- pagebreak -->\n\n{~~old~>new~~} {--gone--} {++added++} {>>comment<<} Footnote[^1]\n\n[^1]: A note\n\n<script>bad()</script>'
    const settings = { ...DEFAULT_SETTINGS, header: 'My header', pageNumbers: true, pageSize: 'a4' as const, margin: 96 }
    const html = pdfHtml(source, settings)
    expect(html).toContain('text-align:center')
    expect(html).toContain('data-page-break')
    expect(html).toContain('<u>Under</u>')
    expect(html).toContain('data-footnote="1"')
    expect(html).toContain('A note')
    expect(html).not.toMatch(/<script>|bad\(\)|old|gone|comment/)
    const zip = await JSZip.loadAsync(await exportDocx(source, settings, 'Heading'))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('w:val="center"')
    expect(xml).toContain('<w:u ')
    expect(xml).toContain('<w:strike')
    expect(xml).toContain('w:type="page"')
    expect(xml).toContain('w:w="11909"')
    expect(xml).toContain('w:top="1440"')
    expect(xml).toContain('new')
    expect(xml).toContain('w:footnoteReference')
    expect(await zip.file('word/footnotes.xml')!.async('string')).toContain('A note')
    expect(xml).not.toMatch(/old|gone|comment|bad\(\)/)
    expect(await zip.file('word/header1.xml')!.async('string')).toContain('My header')
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain('PAGE')
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://example.com')
  })
  it('keeps document settings separate and follows a renamed chapter', () => {
    const { store } = fixture()
    const a = store.create({ book: 'Book', title: 'A' }), b = store.create({ book: 'Book', title: 'B' })
    store.saveSettings({ path: a.path, settings: { font: 'Georgia' } })
    expect(store.settings(b.path)).toEqual({})
    const renamed = store.rename({ path: a.path, title: 'Renamed' })
    expect(store.settings(renamed.path)).toEqual({ font: 'Georgia' })
  })

  it('counts visible chapter words without markup or hidden revision text', () => {
    const { store } = fixture()
    const doc = store.create({ book: 'Book', title: 'Count' })
    const content = '---\ntitle: Hidden Metadata\n---\n\n# Opening\n\n<p style="text-align:center">A <em>quiet</em> place.</p>\n\n[linked words](https://example.com/hidden) [[Secret Path|visible label]] {~~old words~>new text~~} {--deleted text--} {++added text++} {>>hidden comment<<} [^1]\n\n[^1]: Hidden footnote definition\n\n<!-- pagebreak -->'
    store.save({ path: doc.path, original: '', content })
    expect(store.list().books[0].chapters[0].words).toBe(12)
  })

})
