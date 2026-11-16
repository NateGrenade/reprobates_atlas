// Node-only layer: scan the vault folder and watch it. Paths are vault-relative with '/'.
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { watch } from 'chokidar'

const TEXT_EXT = /\.(md|ya?ml|json|base|canvas)$/i
export const isHiddenSeg = (name: string) => name.startsWith('.')
export const toVaultPath = (root: string, abs: string) => relative(root, abs).split(sep).join('/')

/** path -> text for text files, null for binary/other files. Dot-folders (.git, .obsidian, ...) are skipped. */
export async function scanVault(root: string, dirs?: Set<string>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  async function walk(dir: string) {
    const ents = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      ents.map(async (e) => {
        if (isHiddenSeg(e.name)) return
        const abs = join(dir, e.name)
        if (e.isDirectory()) {
          dirs?.add(toVaultPath(root, abs))
          return walk(abs)
        }
        if (!e.isFile()) return
        const p = toVaultPath(root, abs)
        out.set(p, TEXT_EXT.test(e.name) ? await readFile(abs, 'utf8') : null)
      })
    )
  }
  await walk(root)
  return out
}

export interface VaultWatcher { close(): Promise<void> }

/** Calls onChange with the batch of changed vault paths, debounced (default 80 ms). */
export function watchVault(root: string, onChange: (paths: string[]) => void, debounceMs = 80): VaultWatcher {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const w = watch(root, {
    ignoreInitial: true,
    ignored: (p: string) => toVaultPath(root, p).split('/').some((s) => isHiddenSeg(s) && s !== '..' && s !== '.')
  })
  w.on('all', (_ev, abs) => {
    pending.add(toVaultPath(root, abs))
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const batch = [...pending]
      pending.clear()
      onChange(batch)
    }, debounceMs)
  })
  return { close: () => w.close() }
}
