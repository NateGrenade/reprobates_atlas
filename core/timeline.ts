// Derived timelines (contract 5) and character position at time (contract 7). Never stored.
import type { Beat, VaultIndex } from './vault'

export type TimelineRef =
  | { kind: 'main' }
  | { kind: 'character'; id: string }
  | { kind: 'location'; id: string }
  | { kind: 'custom'; slug: string }

export function timelineBeats(ix: VaultIndex, ref: TimelineRef): Beat[] {
  switch (ref.kind) {
    case 'main':
      return ix.beats
    case 'character':
      return ix.beats.filter((b) => b.characters.includes(ref.id))
    case 'location': {
      const sub = ix.subtree(ref.id)
      return ix.beats.filter((b) => b.location !== undefined && sub.has(b.location))
    }
    case 'custom':
      return ix.beats.filter((b) => b.timelines.includes(ref.slug))
  }
}

export type Position =
  | { kind: 'unknown' }
  | { kind: 'at'; location: string; beat: Beat }
  | { kind: 'transit'; from: string; to?: string; fromBeat: Beat; toBeat?: Beat; progress?: number }

/** Where is a character at sort key t? Beats are taken in timeline order (key, order, title). */
export function positionAt(ix: VaultIndex, characterId: string, t: number): Position {
  const located = timelineBeats(ix, { kind: 'character', id: characterId }).filter((b) => b.location)
  let last = -1
  for (let i = 0; i < located.length && located[i].key <= t; i++) last = i
  if (last < 0) return { kind: 'unknown' }
  const b = located[last]
  if (b.move !== 'depart') return { kind: 'at', location: b.location!, beat: b }
  const next = located[last + 1]
  const span = next ? next.key - b.key : 0
  return {
    kind: 'transit',
    from: b.location!,
    to: next?.location,
    fromBeat: b,
    toBeat: next,
    progress: next ? (span > 0 ? (t - b.key) / span : 0) : undefined
  }
}

/** Characters located (not in transit) inside a location's subtree at t. */
export function whoIsHere(ix: VaultIndex, locationId: string, t: number): string[] {
  const sub = ix.subtree(locationId)
  return [...ix.entities.values()]
    .filter((e) => e.type === 'character')
    .filter((e) => {
      const p = positionAt(ix, e.id, t)
      return p.kind === 'at' && sub.has(p.location)
    })
    .map((e) => e.id)
}
