import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEV_VAULT = resolve(__dirname, '../dev-vault')
export const hasDevVault = existsSync(resolve(DEV_VAULT, 'Characters/Elion.md'))

/** Lines changed between two texts, assuming a single contiguous edit. */
export function changedLines(a: string, b: string) {
  const A = a.split('\n'), B = b.split('\n')
  let s = 0
  while (s < A.length && s < B.length && A[s] === B[s]) s++
  let ea = A.length - 1, eb = B.length - 1
  while (ea >= s && eb >= s && A[ea] === B[eb]) { ea--; eb-- }
  return { removed: A.slice(s, ea + 1), added: B.slice(s, eb + 1) }
}

export function vault(files: Record<string, string>): Map<string, string | null> {
  return new Map(Object.entries(files))
}
