// Git sync for the vault (plan: SYNC). Node only. Runs system git through one `git()` method so tests can spy on it.
// Rules: back off while .git/index.lock exists; commit only paths this app wrote (never `add -A`); order is
// commit -> pull (merge) -> push; on conflict stop auto-sync and report, never resolve silently; mode Off runs nothing.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SyncMode = 'auto' | 'manual' | 'off'
export type SyncState = 'off' | 'synced' | 'pending' | 'syncing' | 'conflict' | 'offline' | 'local' | 'locked' | 'error'
export interface SyncStatus {
  state: SyncState
  mode: SyncMode
  pending: string[]
  conflicts: string[]
  message?: string
  lastSync?: number
  remote?: string
}
export interface Commit {
  hash: string
  author: string
  when: string
  subject: string
  files: string[]
}

export interface SyncOptions {
  mode?: SyncMode
  commitDelayMs?: number
  pullIntervalMs?: number
  lockWaitMs?: number
  pendingFile?: string
  onStatus?(s: SyncStatus): void
}

export class SyncEngine {
  mode: SyncMode
  private pending = new Map<string, number>()
  private writeRevision = 0
  private conflicts: string[] = []
  private state: SyncState = 'synced'
  private message?: string
  private lastSync?: number
  private remote?: string
  private commitTimer: ReturnType<typeof setTimeout> | null = null
  private pullTimer: ReturnType<typeof setInterval> | null = null
  private running: Promise<unknown> | null = null
  gitCalls = 0

  constructor(readonly root: string, private opts: SyncOptions = {}) {
    this.mode = opts.mode ?? 'auto'
    this.state = this.mode === 'off' ? 'off' : 'synced'
    if (opts.pendingFile && existsSync(opts.pendingFile)) {
      const paths = JSON.parse(readFileSync(opts.pendingFile, 'utf8')) as string[]
      for (const path of paths) this.pending.set(path, ++this.writeRevision)
      if (this.pending.size && this.mode !== 'off') this.state = 'pending'
    }
  }

  /** Run git in the vault. Every git invocation goes through here. */
  git(args: string[]): Promise<string> {
    this.gitCalls++
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', this.root, ...args], { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'Git is not installed or not available on PATH. Install Git to sync this vault.' : String(stderr || err.message).trim()), { stdout, stderr }))
        else resolve(stdout)
      })
    })
  }

  status(): SyncStatus {
    return { state: this.state, mode: this.mode, pending: [...this.pending.keys()], conflicts: [...this.conflicts], message: this.message, lastSync: this.lastSync, remote: this.remote }
  }
  setRemote(remote: string) {
    this.remote = remote
    this.set(this.pending.size ? 'pending' : 'local', 'Remote connected. Choose how to sync this vault.')
  }
  private set(state: SyncState, message?: string) {
    this.state = state
    this.message = message
    this.opts.onStatus?.(this.status())
  }

  start() {
    if (this.mode !== 'auto') return this.set(this.mode === 'off' ? 'off' : this.pending.size ? 'pending' : 'synced')
    this.sync().catch(() => null)
    this.pullTimer = setInterval(() => this.sync().catch(() => null), this.opts.pullIntervalMs ?? 120_000)
  }
  stop() {
    if (this.pullTimer) clearInterval(this.pullTimer)
    if (this.commitTimer) clearTimeout(this.commitTimer)
    this.pullTimer = this.commitTimer = null
  }
  setMode(mode: SyncMode) {
    this.stop()
    this.mode = mode
    this.start()
  }

  private savePending() {
    if (!this.opts.pendingFile) return
    mkdirSync(dirname(this.opts.pendingFile), { recursive: true })
    writeFileSync(this.opts.pendingFile, JSON.stringify([...this.pending.keys()]))
  }

  /** The app wrote (or moved/deleted) these vault paths. Auto mode commits 30 s after the last write. */
  recordWrite(...paths: string[]) {
    if (this.mode === 'off') return
    paths.forEach((p) => this.pending.set(p, ++this.writeRevision))
    this.savePending()
    if (this.state !== 'conflict') this.set('pending')
    if (this.mode === 'auto' && this.state !== 'conflict') {
      if (this.commitTimer) clearTimeout(this.commitTimer)
      this.commitTimer = setTimeout(() => this.sync().catch(() => null), this.opts.commitDelayMs ?? 30_000)
    }
  }

  private async waitForLock(): Promise<boolean> {
    const lock = join(this.root, '.git', 'index.lock')
    const until = Date.now() + (this.opts.lockWaitMs ?? 10_000)
    while (existsSync(lock)) {
      if (Date.now() > until) return false
      await new Promise((r) => setTimeout(r, 200))
    }
    return true
  }

  /** commit (own paths) -> pull (merge) -> push. Safe to call concurrently; calls are serialised. */
  sync(): Promise<SyncState> {
    if (this.mode === 'off') return Promise.resolve('off')
    const run = (this.running ?? Promise.resolve()).then(() => this.doSync())
    this.running = run.catch(() => null)
    return run
  }

  private async doSync(): Promise<SyncState> {
    if (this.mode === 'off') return 'off'
    try {
      if (this.state === 'conflict' || (await this.unmerged()).length) {
        this.conflicts = await this.unmerged()
        if (this.conflicts.length) return this.set('conflict', 'Resolve the conflicting files to resume sync'), 'conflict'
      }
      if (!(await this.waitForLock())) return this.set('locked', 'Another git process is busy; will retry'), 'locked'
      this.set('syncing')
      await this.commitOwn()
      const remotes = (await this.git(['remote'])).trim()
      this.remote = remotes.split('\n').includes('origin') ? (await this.git(['remote', 'get-url', 'origin'])).trim() : undefined
      if (!remotes) {
        this.lastSync = Date.now()
        return this.set('local', 'No remote configured; changes are committed locally'), 'local'
      }
      if (!(await this.waitForLock())) return this.set('locked', 'Another git process is busy; will retry'), 'locked'
      try {
        await this.git(['pull', '--no-rebase', '--no-edit'])
      } catch (e: any) {
        const unmerged = await this.unmerged()
        if (unmerged.length) {
          this.conflicts = unmerged
          this.stop()
          return this.set('conflict', 'Incoming changes conflict with yours'), 'conflict'
        }
        if (/could not resolve|unable to access|Could not read from remote|network|timed out/i.test(e.message)) return this.set('offline', e.message), 'offline'
        throw e
      }
      const ahead = await this.git(['rev-list', '--count', '@{u}..HEAD']).catch(() => '0')
      if (Number(ahead.trim()) > 0) {
        try {
          await this.git(['push'])
        } catch (e: any) {
          if (/could not resolve|unable to access|Could not read from remote|network|timed out/i.test(e.message)) return this.set('offline', e.message), 'offline'
          throw e
        }
      }
      this.lastSync = Date.now()
      return this.set(this.pending.size ? 'pending' : 'synced'), this.state
    } catch (e: any) {
      return this.set('error', e.message), 'error'
    }
  }

  private async unmerged(): Promise<string[]> {
    if (!existsSync(join(this.root, '.git', 'MERGE_HEAD'))) return []
    return (await this.git(['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean)
  }

  /** Stage and commit only the paths this app wrote. Foreign changes (untracked or modified) are left alone. */
  private async commitOwn() {
    if (!this.pending.size) return
    const revisions = new Map(this.pending)
    const paths = [...revisions.keys()]
    const changed = (await this.git(['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--', ...paths])).split('\0').filter(Boolean).map((l) => l.slice(3))
    if (changed.length) {
      const exists = changed.filter((p) => existsSync(join(this.root, p)))
      const gone = changed.filter((p) => !existsSync(join(this.root, p)))
      if (exists.length) await this.git(['add', '--', ...exists])
      if (gone.length) await this.git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...gone])
      const names = changed.map((p) => p.split('/').pop()!.replace(/\.md$/, ''))
      const summary = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      await this.git(['commit', '-m', `atlas: ${summary}`, '--', ...changed])
    }
    for (const [path, revision] of revisions) if (this.pending.get(path) === revision) this.pending.delete(path)
    this.savePending()
  }

  /** Explicitly publish a vault to an empty remote, including existing local Git history. */
  publishExisting(): Promise<SyncState> {
    const run = (this.running ?? Promise.resolve()).then(() => this.doPublishExisting())
    this.running = run.catch(() => null)
    return run
  }

  private async doPublishExisting(): Promise<SyncState> {
    try {
      if (this.mode === 'off') return this.set('off', 'Turn on sync before publishing'), 'off'
      if ((await this.unmerged()).length) return this.set('conflict', 'Resolve the conflicting files before publishing'), 'conflict'
      if (!(await this.waitForLock())) return this.set('locked', 'Another git process is busy; will retry'), 'locked'
      this.set('syncing')
      this.remote = (await this.git(['remote', 'get-url', 'origin'])).trim()
      if ((await this.git(['ls-remote', '--refs', 'origin'])).trim()) throw new Error('The remote is not empty. Clone it or reconcile its history before publishing.')
      const revisions = new Map(this.pending)
      const exclusions = ['**/.obsidian/workspace*.json', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/id_rsa*', '**/id_ed25519*', '**/.ssh/**']
      if ((await this.git(['ls-files', '-z'])).length) await this.git(['add', '-u', '--', '.'])
      await this.git(['add', '-A', '--', '.', ...exclusions.map(pattern => `:(exclude,glob)${pattern}`)])
      const staged = (await this.git(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean)
      if (staged.length) await this.git(['commit', '-m', 'atlas: publish vault'])
      for (const [path, revision] of revisions) if (staged.includes(path) && this.pending.get(path) === revision) this.pending.delete(path)
      this.savePending()
      await this.git(['push', '--set-upstream', 'origin', 'HEAD'])
      this.lastSync = Date.now()
      return this.set(this.pending.size ? 'pending' : 'synced'), this.state
    } catch (e: any) {
      return this.set('error', e.message), 'error'
    }
  }

  /** Resolve one conflicted file with our or their version; completes the merge when none are left. */
  async resolve(path: string, side: 'mine' | 'theirs') {
    await this.git(['checkout', side === 'mine' ? '--ours' : '--theirs', '--', path])
    await this.git(['add', '--', path])
    this.conflicts = await this.unmerged()
    if (!this.conflicts.length) {
      await this.git(['commit', '--no-edit'])
      this.set('pending')
      if (this.mode === 'auto') this.start()
      else await this.sync()
    } else this.set('conflict', 'Resolve the conflicting files to resume sync')
  }

  /** Both sides of a conflicted file (git index stages 2 and 3). */
  async both(path: string): Promise<{ mine: string; theirs: string }> {
    const [mine, theirs] = await Promise.all([this.git(['show', `:2:${path}`]).catch(() => ''), this.git(['show', `:3:${path}`]).catch(() => '')])
    return { mine, theirs }
  }

  async activity(n = 25): Promise<Commit[]> {
    if (this.mode === 'off') return []
    const out = await this.git(['log', `-n${n}`, '--format=%x1e%H%x1f%an%x1f%ar%x1f%s', '--name-only']).catch(() => '')
    return out
      .split('\x1e')
      .filter((b) => b.trim())
      .map((b) => {
        const [head, ...rest] = b.split('\n')
        const [hash, author, when, subject] = head.split('\x1f')
        return { hash, author, when, subject, files: rest.map((s) => s.trim()).filter(Boolean) }
      })
  }
}

export async function isGitRepo(root: string) {
  return existsSync(join(root, '.git'))
}

/** Attach an origin without fetching, staging, committing, or pushing. */
export async function connectRemote(root: string, url: string): Promise<void> {
  const remote = url.trim()
  if (!remote || remote.startsWith('-') || /[\r\n\0]/.test(remote)) throw new Error('Enter a valid Git remote URL')
  const git = new SyncEngine(root, { mode: 'manual' })
  if (!existsSync(join(root, '.git'))) await git.git(['init', '-b', 'main'])
  const remotes = (await git.git(['remote'])).split('\n')
  if (remotes.includes('origin')) {
    const current = (await git.git(['remote', 'get-url', 'origin'])).trim()
    if (current !== remote) throw new Error('This vault already has an origin remote. Its existing remote was not changed.')
  } else await git.git(['remote', 'add', 'origin', remote])
  const branch = (await git.git(['symbolic-ref', '--short', 'HEAD'])).trim()
  const existing = await git.git(['config', '--get', `branch.${branch}.remote`]).catch(() => '')
  if (!existing.trim()) {
    await git.git(['config', `branch.${branch}.remote`, 'origin'])
    await git.git(['config', `branch.${branch}.merge`, `refs/heads/${branch}`])
  }
}
