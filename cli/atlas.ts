#!/usr/bin/env node
// atlas CLI: validate, query, add-beat, add-location, set. All read/write plain vault files (see Atlas/README.md).
import { resolve, dirname, join } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { scanVault } from '../core/node'
import { validateVault } from '../core/validate'
import { addBeat, addLocation, parseValue, queryBeats, queryEntities, setKeyWrites, whereWas, type Write } from '../core/ops'

const USAGE = `atlas <command> [options]          (vault = --vault <dir>, default: current directory)

  validate                              check Atlas files against the contract; exit 1 on errors
  query entities [--type character]     list entities
  query beats [--from -8] [--to "0 d40"] [--character Elion] [--location X] [--timeline slug]
  query where-was <name> <date>         where a character is at a date, e.g. where-was Elion "0 d20" or "14 Thaw 1200 AE"
  add-beat --title T --date D [--character Elion]... [--location X] [--move arrive|depart|stay]
           [--timeline slug]... [--status s] [--description d] [--body text]
  add-location --name N [--parent P] [--kind city] [--pos x,y,z] [--size 6] [--color #hex]
           [--folder Atlas/Places] [--scene | --scene-json '{"preset":"city","params":{}}']
  set <note path or entity> <key> <value>   value is JSON if it parses, else text; re-dating an event
                                        (year/day/hour/minute) also moves sub-events with follows_main: true

  --json   machine-readable output
`

function parse(argv: string[]) {
  const pos: string[] = []
  const opt: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) (opt[k] ??= []).push('true')
      else (opt[k] ??= []).push(next), i++
    } else pos.push(a)
  }
  return { pos, opt, one: (k: string) => opt[k]?.[opt[k].length - 1], many: (k: string) => opt[k] ?? [] }
}

function apply(root: string, writes: Write[]) {
  for (const w of writes) {
    const abs = join(root, w.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, w.text)
  }
}

async function main(argv: string[]) {
  const { pos, one, many } = parse(argv)
  const json = one('json') === 'true'
  const [cmd, ...rest] = pos
  const root = resolve(one('vault') ?? (cmd === 'validate' && rest[0] ? rest[0] : '.'))
  if (!cmd || !existsSync(root)) return process.stderr.write(USAGE), 2
  const files = await scanVault(root)
  const out = (data: unknown, text: string) => process.stdout.write(json ? JSON.stringify(data, null, 2) + '\n' : text + '\n')

  switch (cmd) {
    case 'validate': {
      const issues = validateVault(files)
      const errors = issues.filter((i) => i.severity === 'error')
      out({ ok: errors.length === 0, issues }, [...issues.map((i) => `${i.file}:${i.line}: ${i.severity}: ${i.message}`), `${errors.length} error(s), ${issues.length - errors.length} warning(s) in ${files.size} files`].join('\n'))
      return errors.length ? 1 : 0
    }
    case 'query': {
      const [what, a, b] = rest
      if (what === 'entities') {
        const r = queryEntities(files, one('type'))
        return out(r, r.map((e) => `${e.type.padEnd(9)} ${e.name}  (${e.id})`).join('\n')), 0
      }
      if (what === 'beats') {
        const r = queryBeats(files, { from: one('from'), to: one('to'), character: one('character'), location: one('location'), timeline: one('timeline') })
        return out(r, r.map((x) => `${x.date.padEnd(34)} ${x.title}${x.location ? `  @ ${x.location}` : ''}`).join('\n')), 0
      }
      if (what === 'where-was') {
        if (!a || b === undefined) throw new Error('usage: atlas query where-was <name> <date>')
        const r = whereWas(files, a, b)
        return out(r, r.state === 'at' ? `${r.character} is at ${r.at} (since "${r.since}")` : r.state === 'transit' ? `${r.character} is travelling from ${r.from}${r.to ? ` to ${r.to}` : ''}` : `${r.character}: no known location`), 0
      }
      throw new Error('query what? entities | beats | where-was')
    }
    case 'add-beat': {
      if (!one('title') || one('date') === undefined) throw new Error('add-beat needs --title and --date')
      const w = addBeat(files, { title: one('title') ?? '', date: one('date') ?? '', characters: many('character'), location: one('location'), move: one('move'), timelines: many('timeline'), status: one('status'), description: one('description'), body: one('body') })
      apply(root, [w])
      return out({ wrote: [w.path] }, `wrote ${w.path}`), 0
    }
    case 'add-location': {
      const name = one('name')
      if (!name) throw new Error('add-location needs --name')
      const posv = one('pos')?.split(',').map(Number) as [number, number, number] | undefined
      const sceneJson = one('scene-json')
      const ws = addLocation(files, { name, parent: one('parent'), kind: one('kind'), pos: posv, size: one('size') ? Number(one('size')) : undefined, color: one('color'), folder: one('folder'), status: one('status'), description: one('description'), scene: sceneJson ? JSON.parse(sceneJson) : one('scene') === 'true' ? true : undefined })
      apply(root, ws)
      return out({ wrote: ws.map((w) => w.path) }, ws.map((w) => `wrote ${w.path}`).join('\n')), 0
    }
    case 'set': {
      const [target, key, raw] = rest
      if (!target || !key || raw === undefined) throw new Error('usage: atlas set <note> <key> <value>')
      const ws = setKeyWrites(files, target, key, parseValue(raw))
      apply(root, ws)
      return out({ wrote: ws.map((w) => w.path) }, ws.map((w) => `wrote ${w.path}`).join('\n')), 0
    }
    default:
      process.stderr.write(USAGE)
      return 2
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (e) => {
    process.stderr.write(`atlas: ${e?.message ?? e}\n`)
    process.exit(1)
  }
)
