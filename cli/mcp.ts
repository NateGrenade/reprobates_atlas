#!/usr/bin/env node
// MCP server over stdio exposing the same operations as the atlas CLI. Usage: atlas-mcp <vault-dir>
import { resolve, dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { scanVault } from '../core/node'
import { validateVault } from '../core/validate'
import { addBeat, addLocation, parseValue, queryBeats, queryEntities, setKeyWrites, whereWas, type Write } from '../core/ops'
import { sceneSchema } from '../core/scene'

const root = resolve(process.argv[2] ?? process.env.ATLAS_VAULT ?? '.')
const server = new McpServer({ name: 'reprobates-atlas', version: '0.1.0' })
const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })
const files = () => scanVault(root)
const apply = (ws: Write[]) => {
  for (const w of ws) {
    mkdirSync(dirname(join(root, w.path)), { recursive: true })
    writeFileSync(join(root, w.path), w.text)
  }
  return ws.map((w) => w.path)
}
const safe = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return text(await fn(a))
  } catch (e: any) {
    return { ...text(`Error: ${e?.message ?? e}`), isError: true }
  }
}

server.registerTool('validate', { description: 'Check Atlas beats, locations, stubs and scene specs against the contract (Atlas/README.md).', inputSchema: {} }, safe(async () => validateVault(await files())))
server.registerTool('list_entities', { description: 'List entities (characters, locations, factions, items, events).', inputSchema: { type: z.string().optional() } }, safe(async (a: { type?: string }) => queryEntities(await files(), a.type)))
server.registerTool(
  'query_beats',
  { description: 'Timeline beats, optionally within a date range (dates like -8, "0 d12", "0 d12 13:45", ~-1000000, or "14 <Month> <year>" in the active calendar) and filtered by character, location (incl. places inside it) or custom timeline slug.', inputSchema: { from: z.string().optional(), to: z.string().optional(), character: z.string().optional(), location: z.string().optional(), timeline: z.string().optional() } },
  safe(async (a: any) => queryBeats(await files(), a))
)
server.registerTool('where_was', { description: 'Where a character is at a date (story form like "0 d20" or a date in the active calendar).', inputSchema: { character: z.string(), date: z.string() } }, safe(async (a: { character: string; date: string }) => whereWas(await files(), a.character, a.date)))
server.registerTool(
  'add_beat',
  { description: 'Create a timeline beat file in Atlas/Timeline/.', inputSchema: { title: z.string(), date: z.string(), characters: z.array(z.string()).optional(), location: z.string().optional(), move: z.enum(['arrive', 'depart', 'stay']).optional(), timelines: z.array(z.string()).optional(), status: z.string().optional(), description: z.string().optional(), body: z.string().optional() } },
  safe(async (a: any) => ({ wrote: apply([addBeat(await files(), a)]) }))
)
server.registerTool(
  'add_location',
  { description: 'Create a location note (default folder Atlas/Places). scene: true for the default preset, or a scene spec object (see get_scene_spec_schema).', inputSchema: { name: z.string(), parent: z.string().optional(), kind: z.string().optional(), pos: z.tuple([z.number(), z.number(), z.number()]).optional(), size: z.number().optional(), color: z.string().optional(), folder: z.string().optional(), scene: z.union([z.literal(true), z.record(z.string(), z.any())]).optional(), status: z.string().optional(), description: z.string().optional() } },
  safe(async (a: any) => ({ wrote: apply(addLocation(await files(), a)) }))
)
server.registerTool(
  'set_property',
  { description: 'Set one frontmatter key on a note (path or entity name). value is JSON if it parses, else text. Only that key changes, except that re-dating an event (year, day, hour, minute) also moves its sub-events that have follows_main: true (see Atlas/README.md, Linked events).', inputSchema: { note: z.string(), key: z.string(), value: z.string() } },
  safe(async (a: { note: string; key: string; value: string }) => ({ wrote: apply(setKeyWrites(await files(), a.note, a.key, parseValue(a.value))) }))
)
server.registerTool('get_scene_spec_schema', { description: 'JSON Schema for Atlas/Maps/*.scene.json files.', inputSchema: {} }, safe(async () => sceneSchema))

await server.connect(new StdioServerTransport())
