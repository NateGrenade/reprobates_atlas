import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectRemote, SyncEngine } from '../core/sync'
import { WriterStorage } from '../addons/writer/storage'
import { watchVault } from '../core/node'

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' })
const beat = (title: string, day: number) => `---\ntype: beat\ntitle: ${title}\nyear: 0\nday: ${day}\n---\nBody\n`

/** bare remote + two clones (A = this app's vault, B = a collaborator). */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-sync-'))
  const remote = join(dir, 'remote.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  const seed = join(dir, 'seed')
  git(dir, 'init', '-q', '-b', 'main', seed)
  for (const r of [seed]) (git(r, 'config', 'user.name', 'Seed'), git(r, 'config', 'user.email', 's@x'))
  mkdirSync(join(seed, 'Atlas/Timeline'), { recursive: true })
  writeFileSync(join(seed, 'Atlas/Timeline/One.md'), beat('One', 1))
  writeFileSync(join(seed, 'Atlas/Timeline/Two.md'), beat('Two', 2))
  writeFileSync(join(seed, '.gitignore'), '')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-qm', 'seed')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-q', '-u', 'origin', 'main')
  const clone = (name: string) => {
    const p = join(dir, name)
    git(dir, 'clone', '-q', remote, p)
    git(p, 'config', 'core.autocrlf', 'false')
    git(p, 'config', 'user.name', name)
    git(p, 'config', 'user.email', `${name}@x`)
    git(p, 'config', 'pull.rebase', 'false')
    return p
  }
  return { dir, a: clone('A'), b: clone('B') }
}

const edit = (root: string, p: string, text: string) => writeFileSync(join(root, p), text)

describe('git sync (bare remote, two clones)', () => {
  it('an edit in clone A reaches clone B through auto sync with no user action', async () => {
    const { a, b } = setup()
    const A = new SyncEngine(a, { mode: 'manual' })
    edit(a, 'Atlas/Timeline/One.md', beat('One', 5))
    A.recordWrite('Atlas/Timeline/One.md')
    expect(await A.sync()).toBe('synced')
    const B = new SyncEngine(b, { mode: 'auto', pullIntervalMs: 150 })
    B.start()
    const t0 = Date.now()
    while (!readFileSync(join(b, 'Atlas/Timeline/One.md'), 'utf8').includes('day: 5') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50))
    B.stop()
    expect(readFileSync(join(b, 'Atlas/Timeline/One.md'), 'utf8')).toContain('day: 5')
    expect(git(a, 'log', '-1', '--format=%s').trim()).toBe('atlas: One')
  })

  it('simultaneous edits to two different beats merge cleanly', async () => {
    const { a, b } = setup()
    const A = new SyncEngine(a, { mode: 'manual' }), B = new SyncEngine(b, { mode: 'manual' })
    edit(a, 'Atlas/Timeline/One.md', beat('One', 7))
    A.recordWrite('Atlas/Timeline/One.md')
    edit(b, 'Atlas/Timeline/Two.md', beat('Two', 9))
    B.recordWrite('Atlas/Timeline/Two.md')
    expect(await A.sync()).toBe('synced')
    expect(await B.sync()).toBe('synced')
    expect(await A.sync()).toBe('synced')
    for (const r of [a, b]) {
      expect(readFileSync(join(r, 'Atlas/Timeline/One.md'), 'utf8')).toContain('day: 7')
      expect(readFileSync(join(r, 'Atlas/Timeline/Two.md'), 'utf8')).toContain('day: 9')
    }
  })

  it('edits to the same line raise a conflict and keep both versions recoverable', async () => {
    const { a, b } = setup()
    const A = new SyncEngine(a, { mode: 'manual' }), B = new SyncEngine(b, { mode: 'manual' })
    edit(a, 'Atlas/Timeline/One.md', beat('One', 11))
    A.recordWrite('Atlas/Timeline/One.md')
    edit(b, 'Atlas/Timeline/One.md', beat('One', 22))
    B.recordWrite('Atlas/Timeline/One.md')
    expect(await A.sync()).toBe('synced')
    expect(await B.sync()).toBe('conflict')
    expect(B.status().conflicts).toEqual(['Atlas/Timeline/One.md'])
    const both = await B.both('Atlas/Timeline/One.md')
    expect(both.mine).toContain('day: 22')
    expect(both.theirs).toContain('day: 11')
    // further syncs refuse while conflicted
    expect(await B.sync()).toBe('conflict')
    await B.resolve('Atlas/Timeline/One.md', 'theirs')
    expect(readFileSync(join(b, 'Atlas/Timeline/One.md'), 'utf8')).toContain('day: 11')
    expect(B.status().state).not.toBe('conflict')
    // B's own version is still in history
    expect(git(b, 'log', '--all', '--full-history', '-p', '--', 'Atlas/Timeline/One.md')).toContain('day: 22')
  })

  it('waits while .git/index.lock is held, without error or corruption', async () => {
    const { a } = setup()
    const A = new SyncEngine(a, { mode: 'manual', lockWaitMs: 400 })
    edit(a, 'Atlas/Timeline/One.md', beat('One', 3))
    A.recordWrite('Atlas/Timeline/One.md')
    const lock = join(a, '.git/index.lock')
    writeFileSync(lock, '')
    expect(await A.sync()).toBe('locked')
    expect(git(a, 'log', '-1', '--format=%s').trim()).toBe('seed')
    // lock released while waiting: the sync goes through
    const p = A.sync()
    setTimeout(() => rmSync(lock), 150)
    expect(await p).toBe('synced')
    expect(git(a, 'log', '-1', '--format=%s').trim()).toBe('atlas: One')
    expect(git(a, 'fsck', '--no-progress').trim()).toBe('')
  })

  it('never stages a file the app did not write', async () => {
    const { a } = setup()
    const A = new SyncEngine(a, { mode: 'manual' })
    writeFileSync(join(a, 'Foreign.md'), 'someone else')
    edit(a, 'Atlas/Timeline/Two.md', beat('Two', 4)) // modified but not recorded by the app
    edit(a, 'Atlas/Timeline/One.md', beat('One', 6))
    A.recordWrite('Atlas/Timeline/One.md')
    await A.sync()
    const st = git(a, 'status', '--porcelain')
    expect(st).toContain('?? Foreign.md')
    expect(st).toContain(' M Atlas/Timeline/Two.md')
    expect(git(a, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('Atlas/Timeline/One.md')
  })

  it('runs no git command when the setting is Off', async () => {
    const { a } = setup()
    const A = new SyncEngine(a, { mode: 'off' })
    A.start()
    edit(a, 'Atlas/Timeline/One.md', beat('One', 8))
    A.recordWrite('Atlas/Timeline/One.md')
    expect(await A.sync()).toBe('off')
    await A.activity().catch(() => null)
    A.stop()
    expect(A.gitCalls).toBe(0)
    expect(existsSync(join(a, '.git/index.lock'))).toBe(false)
    expect(git(a, 'log', '-1', '--format=%s').trim()).toBe('seed')
  })
  it('syncs writer create, save, import and rename and reports incoming changes to the vault watcher', async () => {
    const { dir, a, b } = setup()
    const A = new SyncEngine(a, { mode: 'manual' }), B = new SyncEngine(b, { mode: 'manual' })
    const writer = new WriterStorage(a, join(dir, 'writer-data'), (...paths) => A.recordWrite(...paths))
    const chapter = writer.create({ book: 'Book', title: 'First' })
    const content = '# Chapter\r\n\r\nA *quiet* place.\r\n'
    writer.save({ path: chapter.path, original: '', content })
    const imported = writer.importChapter('Book', 'Imported', 'Imported text.\n')
    expect(await A.sync()).toBe('synced')
    const renamed = writer.rename({ path: imported.path, title: 'Renamed' })
    expect(await A.sync()).toBe('synced')
    const changed: string[] = []
    const watcher = watchVault(b, paths => changed.push(...paths), 20)
    try {
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(await B.sync()).toBe('synced')
      const until = Date.now() + 3000
      while (!changed.includes(chapter.path) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 30))
      expect(readFileSync(join(b, chapter.path), 'utf8')).toBe(content)
      expect(readFileSync(join(b, renamed.path), 'utf8')).toBe('Imported text.\n')
      expect(existsSync(join(b, imported.path))).toBe(false)
      expect(changed).toContain(chapter.path)
    } finally { await watcher.close() }
  })
  it('retains pending files when a commit fails and succeeds on retry', async () => {
    const { a } = setup()
    const A = new SyncEngine(a, { mode: 'manual' })
    edit(a, 'Atlas/Timeline/One.md', 'new content')
    A.recordWrite('Atlas/Timeline/One.md')
    const original = A.git.bind(A)
    const spy = vi.spyOn(A, 'git').mockImplementation(args => args[0] === 'commit' ? Promise.reject(new Error('Author identity unknown')) : original(args))
    expect(await A.sync()).toBe('error')
    expect(A.status().pending).toEqual(['Atlas/Timeline/One.md'])
    expect(A.status().message).toContain('Author identity unknown')
    spy.mockRestore()
    expect(await A.sync()).toBe('synced')
    expect(A.status().pending).toEqual([])
  })
  it('explains a missing remote and a missing Git executable', async () => {
    const { a } = setup()
    git(a, 'remote', 'remove', 'origin')
    const A = new SyncEngine(a, { mode: 'manual' })
    expect(await A.sync()).toBe('local')
    expect(A.status().message).toMatch(/No remote configured/)
    const path = process.env.PATH
    try {
      process.env.PATH = ''
      expect(await A.sync()).toBe('error')
      expect(A.status().message).toMatch(/Git is not installed/)
    } finally { process.env.PATH = path }
  })

  it('keeps pending app writes across an app restart', async () => {
    const { dir, a, b } = setup()
    const pendingFile = join(dir, 'app-data', 'pending.json')
    const before = new SyncEngine(a, { mode: 'manual', pendingFile })
    edit(a, 'Atlas/Timeline/One.md', 'saved before quitting')
    before.recordWrite('Atlas/Timeline/One.md')
    before.stop()
    const after = new SyncEngine(a, { mode: 'manual', pendingFile })
    expect(after.status().pending).toEqual(['Atlas/Timeline/One.md'])
    expect(await after.sync()).toBe('synced')
    expect(JSON.parse(readFileSync(pendingFile, 'utf8'))).toEqual([])
    const remote = new SyncEngine(b, { mode: 'manual' })
    expect(await remote.sync()).toBe('synced')
    expect(readFileSync(join(b, 'Atlas/Timeline/One.md'), 'utf8')).toBe('saved before quitting')
  })

  it('keeps both writer versions when remote chapter changes conflict', async () => {
    const { dir, a, b } = setup()
    const A = new SyncEngine(a, { mode: 'manual' }), B = new SyncEngine(b, { mode: 'manual' })
    const wa = new WriterStorage(a, join(dir, 'data-a'), (...paths) => A.recordWrite(...paths))
    const doc = wa.create({ book: 'Book', title: 'Conflict' })
    wa.save({ path: doc.path, original: '', content: 'Original\n' })
    expect(await A.sync()).toBe('synced')
    expect(await B.sync()).toBe('synced')
    const wb = new WriterStorage(b, join(dir, 'data-b'), (...paths) => B.recordWrite(...paths))
    wa.save({ path: doc.path, original: 'Original\n', content: 'First version\n' })
    wb.save({ path: doc.path, original: 'Original\n', content: 'Second version\n' })
    expect(await A.sync()).toBe('synced')
    expect(await B.sync()).toBe('conflict')
    expect(await B.both(doc.path)).toEqual({ mine: 'Second version\n', theirs: 'First version\n' })
  })

  it('connects without upload, then explicitly publishes an existing vault to an empty remote', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-connect-'))
    const vault = join(dir, 'vault'), remote = join(dir, 'remote.git')
    mkdirSync(vault)
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
    writeFileSync(join(vault, 'Story.md'), 'Existing manuscript\n')
    writeFileSync(join(vault, '.env'), 'PRIVATE=secret\n')
    writeFileSync(join(vault, '.gitignore'), 'ignored.md\n')
    writeFileSync(join(vault, 'ignored.md'), 'ignored')
    mkdirSync(join(vault, '.obsidian'))
    writeFileSync(join(vault, '.obsidian', 'workspace.json'), 'private workspace')
    await connectRemote(vault, remote)
    expect(git(dir, '--git-dir', remote, 'for-each-ref').trim()).toBe('')
    expect(git(vault, 'status', '--porcelain')).toContain('?? Story.md')
    git(vault, 'config', 'user.name', 'Test')
    git(vault, 'config', 'user.email', 'test@example.com')
    const engine = new SyncEngine(vault, { mode: 'manual' })
    expect(await engine.publishExisting()).toBe('synced')
    expect(git(dir, '--git-dir', remote, 'show', 'main:Story.md')).toBe('Existing manuscript\n')
    const files = git(dir, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main')
    expect(files).not.toContain('.env')
    expect(files).not.toContain('workspace.json')
    expect(files).not.toContain('ignored.md')
  })
  it('refuses a nonempty remote before staging or committing vault files', async () => {
    const { dir, a } = setup()
    const vault = join(dir, 'another')
    mkdirSync(vault)
    writeFileSync(join(vault, 'Private.md'), 'unpublished')
    await connectRemote(vault, join(dir, 'remote.git'))
    const engine = new SyncEngine(vault, { mode: 'manual' })
    expect(await engine.publishExisting()).toBe('error')
    expect(engine.status().message).toMatch(/remote is not empty/i)
    expect(git(vault, 'status', '--porcelain')).toContain('?? Private.md')
    expect(git(a, 'status', '--porcelain')).toBe('')
  })

  it('publishes existing Git history and preserves already tracked files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-connect-history-'))
    const vault = join(dir, 'vault'), remote = join(dir, 'remote.git')
    git(dir, 'init', '-q', '-b', 'main', vault)
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
    git(vault, 'config', 'user.name', 'Test')
    git(vault, 'config', 'user.email', 'test@example.com')
    writeFileSync(join(vault, '.env'), 'already tracked')
    git(vault, 'add', '-f', '.env')
    git(vault, 'commit', '-qm', 'existing history')
    writeFileSync(join(vault, 'Chapter.md'), 'new chapter')
    writeFileSync(join(vault, '.env'), 'updated tracked file')
    await connectRemote(vault, remote)
    const engine = new SyncEngine(vault, { mode: 'manual' })
    expect(await engine.publishExisting()).toBe('synced')
    expect(git(dir, '--git-dir', remote, 'show', 'main:.env')).toBe('updated tracked file')
    expect(git(dir, '--git-dir', remote, 'log', '--format=%s', 'main')).toContain('existing history')
  })

})
