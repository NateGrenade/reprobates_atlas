import { BrowserWindow, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddonMainContext } from '../../src/main/addons'
import { WriterStorage } from './storage'
import { exportDocx, importDocx, importTitle, pdfHtml, pdfOptions } from './io'

export function activate(ctx: AddonMainContext) {
  const storage = () => {
    const root = ctx.vaultRoot()
    if (!root) throw new Error('Open a vault first')
    return new WriterStorage(root, ctx.dataDir, ctx.recordWrite)
  }
  ctx.handle('list', () => storage().list())
  ctx.handle('read', (path: string) => storage().read(path))
  ctx.handle('save', (args) => storage().save(args))
  ctx.handle('create', (args) => storage().create(args))
  ctx.handle('rename', (args) => storage().rename(args))
  ctx.handle('reorder', (args) => storage().reorder(args))
  ctx.handle('settings:get', (path: string) => storage().settings(path))
  ctx.handle('settings:save', (settings) => storage().saveSettings(settings))
  ctx.handle('snapshots:list', (path: string) => storage().snapshots(path))
  ctx.handle('snapshots:create', (args) => storage().snapshot(args))
  ctx.handle('snapshots:read', (args) => storage().snapshotRead(args))
  ctx.handle('import', async ({ book }: { book: string }) => {
    const result = await dialog.showOpenDialog({ title: 'Import a chapter', properties: ['openFile'], filters: [{ name: 'Word document', extensions: ['docx'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const content = await importDocx(result.filePaths[0])
    const base = importTitle(result.filePaths[0])
    const store = storage()
    const existing = new Set(store.list().books.find(b => b.name === book)?.chapters.map(c => c.title) ?? [])
    let title = base, n = 2
    while (existing.has(title)) title = `${base} ${n++}`
    return store.importChapter(book, title, content)
  })
  ctx.handle('export', async ({ path, content, format, settings }: { path: string; content: string; format: 'md' | 'docx' | 'pdf'; settings: any }) => {
    storage().read(path)
    if (!['md', 'docx', 'pdf'].includes(format)) throw new Error('Unknown export format')
    const result = await dialog.showSaveDialog({ title: 'Export chapter', defaultPath: path.split('/').pop()!.replace(/\.md$/, `.${format}`), filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (result.canceled || !result.filePath) return null
    if (format === 'md') writeFileSync(result.filePath, content, 'utf8')
    else if (format === 'docx') writeFileSync(result.filePath, await exportDocx(content, settings, path))
    else {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        const font = String(settings.font ?? '').toLowerCase()
        let faces = ''
        if (font === 'fraunces' || font === 'inter') {
          const dir = join(dirname(fileURLToPath(import.meta.url)), 'fonts')
          for (const style of ['normal', 'italic']) {
            const data = readFileSync(join(dir, `${font}-latin-wght-${style}.woff2`)).toString('base64')
            faces += `@font-face { font-family: '${font}'; font-style: ${style}; font-weight: 100 900; src: url(data:font/woff2;base64,${data}) format('woff2'); }`
          }
        }
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pdfHtml(content, settings, faces))}`)
        await win.webContents.executeJavaScript('document.fonts.ready')
        writeFileSync(result.filePath, await win.webContents.printToPDF(pdfOptions(settings)))
      } finally { win.destroy() }
    }
    return result.filePath
  })
}
