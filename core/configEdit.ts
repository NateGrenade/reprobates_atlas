// Edit atlas.yaml keys through the YAML document model (keeps other keys and comments).
import { parseDocument } from 'yaml'

export function setConfigKeys(text: string, patch: Record<string, unknown>): string {
  const doc = parseDocument(text || '')
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) doc.delete(k)
    else doc.set(k, v)
  }
  return String(doc)
}

