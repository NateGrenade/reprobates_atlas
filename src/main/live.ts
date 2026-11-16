// Atlas Live: an MCP server on 127.0.0.1 that lets an agent see and steer the running app (plan/next.md, piece 3).
// One implementation for the in-app assistant, Claude Code and Codex. The address is written to <userData>/live.json.
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })

function build(win: () => BrowserWindow | null) {
  const server = new McpServer({ name: 'atlas-live', version: app.getVersion() })
  const page = async (name: string, arg?: unknown) => {
    const w = win()
    if (!w) throw new Error('The Atlas window is closed.')
    const r = await w.webContents.executeJavaScript(`window.__atlasLive.call(${JSON.stringify(name)}, ${JSON.stringify(arg ?? null)})`, true)
    if (r.error) throw new Error(r.error)
    return r.value
  }
  const safe = <A,>(fn: (a: A) => Promise<any>) => async (a: A) => {
    try {
      return await fn(a)
    } catch (e: any) {
      return { ...text(`Error: ${e?.message ?? e}`), isError: true }
    }
  }
  server.registerTool(
    'get_state',
    { description: 'What the Reprobates Atlas app is showing right now: view, map level, selected item (vault path and its properties), open note, time cursor.', inputSchema: {}, annotations: { readOnlyHint: true } },
    safe(async () => text(await page('state')))
  )
  server.registerTool(
    'capture_view',
    { description: 'A picture of the Atlas window as the user sees it now. Use it to look at the map, a planet, the timeline or a character card.', inputSchema: {}, annotations: { readOnlyHint: true } },
    safe(async () => {
      const w = win()
      if (!w) throw new Error('The Atlas window is closed.')
      // a window that is covered or in the background stops painting; wake it and wait for the scene to settle
      w.webContents.setBackgroundThrottling(false)
      w.webContents.invalidate()
      await w.webContents.executeJavaScript('new Promise((r) => { let n = 0; const f = () => (++n > 45 ? r(0) : requestAnimationFrame(f)); requestAnimationFrame(f); setTimeout(r, 2500) })', true)
      const img = await w.webContents.capturePage()
      w.webContents.setBackgroundThrottling(true)
      const size = img.getSize()
      const png = (size.width > 1440 ? img.resize({ width: 1440 }) : img).toPNG()
      return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] }
    })
  )
  server.registerTool(
    'navigate',
    {
      description: 'Change what the Atlas shows: switch view, enter a map level, select an item, or open a note. Paths are vault-relative (as in get_state). Returns the new state.',
      inputSchema: { view: z.enum(['map', 'timeline', 'characters', 'files']).optional(), map_level: z.string().nullable().optional(), select: z.string().nullable().optional(), note: z.string().optional() }
    },
    safe(async (a: object) => text(await page('navigate', a)))
  )
  server.registerTool('list_files', { description: 'List vault file paths for navigation and reading.', inputSchema: {}, annotations: { readOnlyHint: true } }, safe(async () => text(await page('listFiles'))))
  server.registerTool('read_file', { description: 'Read a vault text file by its relative path.', inputSchema: { path: z.string() }, annotations: { readOnlyHint: true } }, safe(async (a: { path: string }) => text(await page('readFile', a.path))))
  server.registerTool('create_file', { description: 'Propose a new Markdown, YAML or JSON file in the vault. The user reviews its complete content and must approve it before it is created. Only write lore when explicitly asked; do not draft manuscript prose unless explicitly requested in this session.', inputSchema: { path: z.string(), content: z.string() } }, safe(async (a: object) => text(await page('proposeFile', a))))
  server.registerTool('edit_file', { description: 'Propose a precise replacement in an existing vault text file. before must match exactly once; the user sees both passages and must approve before saving. Do not edit the open manuscript with this tool; use Writer tools.', inputSchema: { path: z.string(), before: z.string().min(1), after: z.string() } }, safe(async (a: object) => text(await page('proposeFile', a))))
  server.registerTool('read_manuscript', { description: 'Read the open Writer document and selection.', inputSchema: {}, annotations: { readOnlyHint: true } }, safe(async () => text(await page('writerRead'))))
  server.registerTool('comment_manuscript', { description: 'Propose a comment on an exact passage in the open Writer document. The user reviews and approves it.', inputSchema: { quote: z.string().min(1), text: z.string().min(1) } }, safe(async (a: object) => text(await page('writerChange', { ...a, action: 'comment' }))))
  server.registerTool('suggest_manuscript', { description: 'Propose an edit to an exact passage in the open Writer document. The user reviews and approves the suggestion. Do not write manuscript prose unless explicitly requested this session.', inputSchema: { quote: z.string().min(1), replacement: z.string(), reason: z.string().optional() } }, safe(async (a: object) => text(await page('writerChange', { ...a, action: 'suggest' }))))
  server.registerTool('replace_manuscript', { description: 'Propose replacing the open Writer document. Only available when the user enabled drafting for this session and explicitly asked for manuscript prose. The user must approve the complete document.', inputSchema: { content: z.string() } }, safe(async (a: object) => text(await page('writerChange', { ...a, action: 'replace' }))))
  const path = z.string().describe('vault path of the place, as in get_state (e.g. Atlas/Places/potato.md)')
  server.registerTool(
    'describe_scene',
    { description: 'How a place on the map looks: its current settings and every setting that can be changed, with ranges. Call this before preview_scene.', inputSchema: { path }, annotations: { readOnlyHint: true } },
    safe(async (a: { path: string }) => text(await page('describeScene', a.path)))
  )
  server.registerTool(
    'preview_scene',
    {
      description: 'Show a changed look for a place without saving it (the map goes to that place). params are merged into the current settings; use keys from describe_scene; null resets a key to its default. seed picks a different random layout. Then capture_view to check it.',
      inputSchema: { path, params: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(), seed: z.number().optional() }
    },
    safe(async (a: object) => text(await page('previewScene', a)))
  )
  server.registerTool('revert_scene', { description: 'Drop the unsaved preview of a place, back to its saved look.', inputSchema: { path } }, safe(async (a: { path: string }) => text(await page('revertScene', a.path))))
  server.registerTool(
    'apply_scene',
    { description: 'Save the previewed look of a place to the vault. The user is shown the changes in the app and must press Apply; this call waits for their answer (up to 3 minutes).', inputSchema: { path }, annotations: { destructiveHint: false } },
    safe(async (a: { path: string }) => text(await page('applyScene', a.path)))
  )
  return server
}

let http: Server | null = null

export function startLive(win: () => BrowserWindow | null): Promise<{ url: string }> {
  const token = randomBytes(18).toString('hex')
  const file = join(app.getPath('userData'), 'live.json')
  http = createServer(async (req, res) => {
    if (req.url !== `/mcp/${token}`) return void res.writeHead(404).end()
    if (req.method !== 'POST') return void res.writeHead(405).end()
    // stateless: a fresh server per request, so nothing is held between calls
    const server = build(win)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
  })
  app.on('will-quit', () => {
    http?.close()
    rmSync(file, { force: true })
  })
  return new Promise((done) =>
    http!.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${(http!.address() as any).port}/mcp/${token}`
      writeFileSync(file, JSON.stringify({ url, pid: process.pid }), { mode: 0o600 })
      done({ url })
    })
  )
}
