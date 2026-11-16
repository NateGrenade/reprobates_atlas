import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { scanVault } from '../core/node'
import { addBeat, addLocation, whereWas, setKey } from '../core/ops'
import { validateVault } from '../core/validate'

function vault() {
  const d = mkdtempSync(join(tmpdir(), 'atlas-ai-'))
  mkdirSync(join(d, 'Characters'))
  mkdirSync(join(d, 'Atlas/Timeline'), { recursive: true })
  writeFileSync(join(d, 'Characters/Elion.md'), '---\nstatus: provisional\ntype: character\n---\nBody\n')
  writeFileSync(join(d, 'Planet.md'), '---\ntype: location\nmap_kind: planet\n---\n')
  return d
}
const TSX = ['--import', 'tsx']
const CLI = resolve(__dirname, '../cli/atlas.ts')

describe('AI interface', () => {
  it('CLI add-location --scene and add-beat write valid files; where-was answers', async () => {
    const d = vault()
    execFileSync(process.execPath, [...TSX, CLI, 'add-location', '--vault', d, '--name', 'Capital', '--parent', 'Planet', '--kind', 'city', '--pos', '10,40,0', '--scene'])
    execFileSync(process.execPath, [...TSX, CLI, 'add-beat', '--vault', d, '--title', 'Elion enters the Capital', '--date', '0 d12', '--character', 'Elion', '--location', 'Capital', '--move', 'arrive'])
    execFileSync(process.execPath, [...TSX, CLI, 'add-beat', '--vault', d, '--title', 'Elion leaves the Capital', '--date', '0 d30', '--character', 'Elion', '--location', 'Capital', '--move', 'depart'])
    const files = await scanVault(d)
    expect(validateVault(files).filter((i) => i.severity === 'error')).toEqual([])
    expect(readFileSync(join(d, 'Atlas/Places/Capital.md'), 'utf8')).toContain('map_scene: Atlas/Maps/capital.scene.json')
    const r = JSON.parse(execFileSync(process.execPath, [...TSX, CLI, 'query', 'where-was', 'Elion', '0 d20', '--vault', d, '--json'], { encoding: 'utf8' }))
    expect(r).toMatchObject({ state: 'at', at: 'Capital' })
    expect(whereWas(files, 'Elion', '0 d40')).toMatchObject({ state: 'transit', from: 'Capital' })
  })

  it('set patches one key; ops reject unknown references', async () => {
    const d = vault()
    const files = await scanVault(d)
    const w = setKey(files, 'Elion', 'role', 'Protagonist')
    expect(w.text).toBe('---\nstatus: provisional\ntype: character\nrole: Protagonist\n---\nBody\n')
    expect(() => addBeat(files, { title: 'x', date: '0', characters: ['Nobody'] })).toThrow(/No character/)
    expect(() => addLocation(files, { name: 'Y', parent: 'Nowhere' })).toThrow(/No parent/)
  })

  it('CLI dates follow the active calendar (months, labels, hours)', async () => {
    const d = vault()
    writeFileSync(join(d, 'Atlas/atlas.yaml'), 'calendars:\n  - slug: a\n    name: A\n    year_zero_offset: 1200\n    after_label: AE\n    months: [{name: Frostmoon, days: 30}, {name: Thaw, days: 30}, {name: Rest, days: 240}]\n    hours_per_day: 20\n')
    execFileSync(process.execPath, [...TSX, CLI, 'add-beat', '--vault', d, '--title', 'Dawn', '--date', '15 Thaw 1200 AE 13:30', '--character', 'Elion'])
    const text = readFileSync(join(d, 'Atlas/Timeline/Dawn.md'), 'utf8')
    expect(text).toContain('year: 0\nday: 38\nhour: 5\nminute: 30\n')
    const q = JSON.parse(execFileSync(process.execPath, [...TSX, CLI, 'query', 'beats', '--vault', d, '--json'], { encoding: 'utf8' }))
    expect(q[0]).toMatchObject({ date: '15 Thaw 1,200 AE 13:30', hour: 5, minute: 30 }) // stored values are standard measure
    expect(validateVault(await scanVault(d)).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('MCP server lists tools and answers where_was', async () => {
    const d = vault()
    execFileSync(process.execPath, [...TSX, CLI, 'add-location', '--vault', d, '--name', 'Capital', '--parent', 'Planet', '--kind', 'city'])
    execFileSync(process.execPath, [...TSX, CLI, 'add-beat', '--vault', d, '--title', 'Arrive', '--date', '0 d12', '--character', 'Elion', '--location', 'Capital', '--move', 'arrive'])
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [...TSX, resolve(__dirname, '../cli/mcp.ts'), d] }))
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(['add_beat', 'add_location', 'get_scene_spec_schema', 'list_entities', 'query_beats', 'set_property', 'validate', 'where_was'])
    const r: any = await client.callTool({ name: 'where_was', arguments: { character: 'Elion', date: '0 d20' } })
    expect(JSON.parse(r.content[0].text)).toMatchObject({ state: 'at', at: 'Capital' })
    await client.close()
  })
})
