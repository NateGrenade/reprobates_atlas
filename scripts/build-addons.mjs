// Build each add-on in addons/<id>/ into out/addons/<id>/ (addon.json, renderer.js, main.js).
// usage: node scripts/build-addons.mjs [--out <dir>] [id ...]   (no ids = all; default out dir: out/addons)
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const outRoot = argv[0] === '--out' ? resolve(argv.splice(0, 2)[1]) : join(root, 'out/addons')
const ids = argv.length ? argv : readdirSync(join(root, 'addons')).filter((d) => existsSync(join(root, 'addons', d, 'addon.json')))
const pick = (dir, name) => ['.tsx', '.ts', '.js'].map((e) => join(dir, name + e)).find(existsSync)
for (const id of ids) {
  const src = join(root, 'addons', id)
  const out = join(outRoot, id)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(join(src, 'addon.json'), join(out, 'addon.json'))
  if (id === 'writer') {
    mkdirSync(join(out, 'fonts'), { recursive: true })
    for (const family of ['fraunces', 'inter']) for (const style of ['normal', 'italic']) {
      const file = `${family}-latin-wght-${style}.woff2`
      cpSync(join(root, 'node_modules/@fontsource-variable', family, 'files', file), join(out, 'fonts', file))
    }
  }
  const common = { bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning', alias: { '@core': join(root, 'core') } }
  const r = pick(src, 'renderer')
  if (r) await build({ ...common, entryPoints: [r], outfile: join(out, 'renderer.js'), platform: 'browser', jsx: 'automatic', loader: { '.css': 'text' }, alias: { ...common.alias, react: join(root, 'addons/_shim/react.js'), 'react-dom': join(root, 'addons/_shim/react-dom.js'), 'react/jsx-runtime': join(root, 'addons/_shim/jsx-runtime.js') } })
  const m = pick(src, 'main')
  if (m) await build({ ...common, entryPoints: [m], outfile: join(out, 'main.js'), platform: 'node', external: ['electron'], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } })
  console.log('built add-on', id)
}
