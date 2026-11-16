// Assistant add-on, main side. Sessions run here, not in the window, so hiding the prompt bar never stops one.
// Claude runs through the Agent SDK on the Claude Code installed on this computer; Codex through `codex exec`.
// Both get only the Atlas Live tools (src/main/live.ts). Nothing here holds a key or token.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import type { AddonMainContext } from '../../src/main/addons'
import type { Message, Provider, ProviderStatus, Session, Step, ModelOption, Selection } from './types'

const run = (cmd: string, args: string[]) => new Promise<{ code: number; out: string }>((done) => execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => done({ code: err ? ((err as any).code ?? 1) : 0, out: String(stdout) + String(stderr) })))

/** Find a CLI the way the user's terminal would (a GUI app's PATH is nearly empty). */
const found = new Map<string, string | null>()
async function which(bin: string): Promise<string | null> {
  if (found.has(bin)) return found.get(bin)!
  const r = process.platform === 'win32' ? await run('where', [bin]) : await run(process.env.SHELL || '/bin/zsh', ['-lc', `command -v ${bin}`])
  const p = r.code === 0 ? r.out.trim().split('\n').pop()!.trim() : ''
  found.set(bin, p && existsSync(p) ? p : null)
  return found.get(bin)!
}

const PREAMBLE = `You are the assistant inside Reprobates Atlas, a desktop app over the user's worldbuilding vault (the current folder). The atlas tools let you see what the app shows (get_state, capture_view), steer it (navigate), and change how a place looks (describe_scene, preview_scene, then apply_scene, which asks the user to approve in the app; revert_scene drops a preview). After a preview, look with capture_view before applying. When the user says "this", "here" or "on screen", call get_state and, for anything visual, capture_view. Vault paths are relative to the current folder. Be brief and plain. Use list_files and read_file to inspect the vault. create_file and edit_file propose concrete changes for user approval. Use the Writer tools for an open manuscript. Do not write or change lore unless the user asks. Do not draft or suggest replacement manuscript prose unless the user explicitly asks during this session.`

export function activate(ctx: AddonMainContext) {
  mkdirSync(ctx.dataDir, { recursive: true })
  const file = join(ctx.dataDir, 'sessions.json')
  let sessions: Session[] = []
  try {
    sessions = JSON.parse(readFileSync(file, 'utf8'))
    for (const s of sessions) s.running = false
  } catch {
    // first run
  }
  const stops = new Map<string, () => void>()
  const save = () => writeFileSync(file, JSON.stringify(sessions.slice(0, 60)))
  const push = (s: Session) => {
    s.updated = Date.now()
    ctx.send('session', s)
  }

  async function status(): Promise<Record<string, ProviderStatus>> {
    const out: Record<string, ProviderStatus> = {}
    const claude = await which('claude')
    if (!claude) out.claude = { installed: false, signedIn: false, detail: 'Claude Code is not installed on this computer.' }
    else {
      const r = await run(claude, ['auth', 'status'])
      let ok = false
      try {
        ok = JSON.parse(r.out).loggedIn === true
      } catch {
        ok = false
      }
      out.claude = { installed: true, signedIn: ok, detail: ok ? 'Signed in to Claude Code.' : 'Not signed in. Run "claude auth login" in a terminal.' }
    }
    const codex = await which('codex')
    if (!codex) out.codex = { installed: false, signedIn: false, detail: 'Codex is not installed on this computer.' }
    else {
      const r = await run(codex, ['login', 'status'])
      const ok = r.code === 0 && /logged in/i.test(r.out) && !/not logged in/i.test(r.out)
      out.codex = { installed: true, signedIn: ok, detail: ok ? r.out.trim().split('\n')[0] + '.' : 'Not signed in. Run "codex login" in a terminal.' }
    }
    if (process.env.ATLAS_ASSISTANT_FAKE) out.fake = { installed: true, signedIn: true, detail: 'Scripted replies for tests.' }
    return out
  }

  /** One turn. `add` appends to the reply as it arrives. */
  async function claudeTurn(s: Session, prompt: string, add: (step: Step, merge?: boolean) => void, selection: Selection) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const abort = new AbortController()
    stops.set(s.id, () => abort.abort())
    const env = { ...process.env } as Record<string, string>
    delete env.ANTHROPIC_API_KEY // this build uses the Claude Code sign-in on this computer, never a key from the environment
    delete env.CLAUDECODE
    for await (const m of query({
      prompt,
      options: {
        cwd: s.vault,
        ...(selection.model ? { model: selection.model } : {}),
        ...(selection.effort ? { effort: selection.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
        resume: s.remoteId,
        abortController: abort,
        pathToClaudeCodeExecutable: (await which('claude'))!,
        env,
        tools: [],
        mcpServers: { atlas: { type: 'http', url: ctx.liveUrl()! } },
        strictMcpConfig: true,
        allowedTools: ['mcp__atlas__*'],
        settingSources: [],
        includePartialMessages: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: PREAMBLE }
      }
    })) {
      const a = m as any
      if (a.session_id && !s.remoteId) s.remoteId = a.session_id
      if (a.type === 'stream_event' && a.event?.type === 'content_block_delta' && a.event.delta?.type === 'text_delta') add({ kind: 'text', text: a.event.delta.text }, true)
      else if (a.type === 'stream_event' && a.event?.type === 'content_block_start' && a.event.content_block?.type === 'tool_use') add({ kind: 'tool', text: toolLabel(a.event.content_block.name) })
      else if (a.type === 'result' && a.subtype !== 'success') throw new Error(a.result || a.subtype)
    }
  }

  async function codexTurn(s: Session, prompt: string, add: (step: Step, merge?: boolean) => void, selection: Selection) {
    const bin = (await which('codex'))!
    // read-only sandbox on every turn, first or resumed: Codex may look and use the atlas tools, not run commands that write
    const head = s.remoteId ? ['exec', 'resume', '--json', '--skip-git-repo-check', '--ignore-user-config', '--disable', 'shell_tool', '--disable', 'unified_exec', '-c', 'sandbox_mode="read-only"'] : ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--disable', 'shell_tool', '--disable', 'unified_exec', '-C', s.vault, '-c', 'sandbox_mode="read-only"']
    const args = [...head, ...(selection.model ? ['-m', selection.model] : []), ...(selection.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(selection.effort)}`] : []), '-c', 'mcp_servers.atlas.default_tools_approval_mode="approve"', '-c', `mcp_servers.atlas.url="${ctx.liveUrl()}"`, ...(s.remoteId ? [s.remoteId] : []), s.remoteId ? prompt : `${PREAMBLE}\n\n${prompt}`]
    const child: ChildProcess = spawn(bin, args, { cwd: s.vault, stdio: ['ignore', 'pipe', 'pipe'] })
    stops.set(s.id, () => child.kill())
    let failed = ''
    let err = ''
    child.stderr!.on('data', (d) => (err = (err + d).slice(-2000)))
    for await (const line of createInterface({ input: child.stdout! })) {
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      if (e.type === 'thread.started') s.remoteId = e.thread_id
      else if (e.type === 'item.started' && e.item?.type === 'mcp_tool_call') add({ kind: 'tool', text: toolLabel(e.item.tool) })
      else if (e.type === 'item.completed' && e.item?.type === 'agent_message') add({ kind: 'text', text: e.item.text })
      else if (e.type === 'turn.failed' || e.type === 'error') failed = e.error?.message ?? e.message ?? 'Codex failed'
    }
    const code: number = await new Promise((done) => (child.exitCode !== null ? done(child.exitCode) : child.on('close', done)))
    if (failed || code) throw new Error(failed || err.trim().split('\n').pop() || `Codex exited with code ${code}`)
  }

  /** Scripted provider for tests (ATLAS_ASSISTANT_FAKE=1): slow enough to hide the bar mid-reply. */
  async function fakeTurn(s: Session, prompt: string, add: (step: Step, merge?: boolean) => void) {
    let stopped = false
    stops.set(s.id, () => (stopped = true))
    s.remoteId ??= 'fake-' + s.id.slice(0, 8)
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    add({ kind: 'tool', text: toolLabel('get_state') })
    await wait(400)
    for (const word of `You asked: ${prompt}. This is a scripted reply.`.split(' ')) {
      if (stopped) throw new Error('Stopped')
      add({ kind: 'text', text: word + ' ' }, true)
      await wait(150)
    }
  }

  const toolLabel = (name: string) => ({ get_state: 'Checking what the Atlas is showing', capture_view: 'Looking at the screen', navigate: 'Moving the Atlas view', describe_scene: 'Reading how this place looks', preview_scene: 'Trying a new look', revert_scene: 'Dropping the preview', apply_scene: 'Asking you to approve the change', list_files: 'Finding vault files', read_file: 'Reading a vault file', create_file: 'Proposing a new file', edit_file: 'Proposing a file edit', read_manuscript: 'Reading the open manuscript', comment_manuscript: 'Proposing a comment', suggest_manuscript: 'Proposing a suggestion', replace_manuscript: 'Proposing manuscript changes' })[name.replace(/^mcp__atlas__/, '')] ?? `Using ${name}`

  ctx.handle('models', async (provider: Provider): Promise<ModelOption[]> => {
    if (provider === 'codex') {
      try {
        const cache = JSON.parse(readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8'))
        return cache.models.filter((m: any) => m.visibility === 'list').map((m: any) => ({ value: m.slug, label: m.display_name, efforts: (m.supported_reasoning_levels ?? []).map((e: any) => e.effort) }))
      } catch { return [] }
    }
    if (provider !== 'claude' || !(await which('claude'))) return []
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const env = { ...process.env } as Record<string, string>
    delete env.ANTHROPIC_API_KEY
    delete env.CLAUDECODE
    const q = query({ prompt: (async function* () { await new Promise(() => {}) })(), options: { pathToClaudeCodeExecutable: (await which('claude'))!, env, tools: [], settingSources: [] } })
    const timer = setTimeout(() => q.close(), 10000)
    try {
      return (await q.supportedModels()).map((m) => ({ value: m.value, label: m.displayName, efforts: m.supportedEffortLevels ?? [] }))
    } catch { return [] } finally { clearTimeout(timer); q.close() }
  })
  ctx.handle('status', status)
  ctx.handle('list', () => sessions.filter((s) => s.vault === ctx.vaultRoot()).map((s) => ({ ...s, messages: [] })))
  ctx.handle('get', (id: string) => sessions.find((s) => s.id === id) ?? null)
  ctx.handle('stop', (id: string) => stops.get(id)?.())
  ctx.handle('send', (a: { id?: string; provider: Provider; text: string; selection?: Selection }) => {
    const vault = ctx.vaultRoot()
    if (!vault) throw new Error('Open a vault first.')
    if (!ctx.liveUrl()) throw new Error('The app is still starting. Try again in a moment.')
    let s = sessions.find((x) => x.id === a.id)
    if (!s) {
      s = { id: randomUUID(), provider: a.provider, title: a.text.slice(0, 60), vault, messages: [], running: false, updated: Date.now() }
      sessions.unshift(s)
    }
    if (s.running) throw new Error('That conversation is still working.')
    const reply: Message = { role: 'assistant', steps: [] }
    s.messages.push({ role: 'user', steps: [{ kind: 'text', text: a.text }] }, reply)
    s.running = true
    push(s)
    const session = s
    const add = (step: Step, merge = false) => {
      const last = reply.steps[reply.steps.length - 1]
      if (merge && last?.kind === step.kind) last.text += step.text
      else reply.steps.push(step)
      push(session)
    }
    const turn = s.provider === 'claude' ? claudeTurn : s.provider === 'codex' ? codexTurn : fakeTurn
    turn(s, a.text, add, a.selection ?? { model: '', effort: '' })
      .catch((e) => (reply.error = String(e?.message ?? e)))
      .finally(() => {
        session.running = false
        stops.delete(session.id)
        save()
        push(session)
        ctx.send('finished', { id: session.id, title: session.title, error: reply.error })
      })
    return s.id
  })
  /** Open the same conversation in the full Claude Code or Codex, in a terminal. */
  ctx.handle('openInApp', async (id: string) => {
    const s = sessions.find((x) => x.id === id)
    if (!s?.remoteId || s.provider === 'fake') return false
    const cmd = s.provider === 'claude' ? `claude --resume ${s.remoteId}` : `codex resume ${s.remoteId}`
    const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`
    if (process.platform === 'darwin') {
      const script = join(ctx.dataDir, 'continue.command')
      writeFileSync(script, `#!/bin/zsh -l\ncd ${q(s.vault)} && ${cmd}\n`, { mode: 0o755 })
      await run('open', [script])
    } else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', 'cmd', '/k', `cd /d "${s.vault}" && ${cmd}`], { detached: true })
    else return false
    return true
  })
}
