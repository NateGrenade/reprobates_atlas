// Map labels as one DOM layer over the canvas, projected each frame (no per-label portals).
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

export interface LabelEntry {
  key: string
  name: string
  kind: string
  importance: number
  selected: boolean
  anchor: THREE.Object3D | null
  alpha: number
  el: HTMLDivElement | null
}

const entries = new Map<string, LabelEntry>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function registerLabel(e: LabelEntry) {
  entries.set(e.key, e)
  emit()
  return () => {
    if (entries.get(e.key) === e) entries.delete(e.key)
    emit()
  }
}
export function updateLabel(key: string, patch: Partial<LabelEntry>) {
  const e = entries.get(key)
  if (!e) return
  const changed = (patch.selected !== undefined && patch.selected !== e.selected) || (patch.name !== undefined && patch.name !== e.name)
  Object.assign(e, patch)
  if (changed) emit()
}

/** DOM side: renders one element per registered label. */
export function LabelLayer() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return (
    <div className="label-layer">
      {[...entries.values()].map((e) => (
        <div key={e.key} ref={(el) => void (e.el = el)} className={`loc-label${e.selected ? ' selected' : ''}`} style={{ opacity: 0 }}>
          <span className="kind">{e.kind}</span>
          <span className="name" style={{ fontSize: `calc(${12 + e.importance * 6}px * var(--ui-scale))` }}>
            {e.name}
          </span>
          <span className="leader" />
        </div>
      ))}
    </div>
  )
}

/** Canvas side: projects anchors to screen and writes transforms/opacity directly. */
export function LabelProjector() {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    for (const e of entries.values()) {
      if (!e.el || !e.anchor) continue
      e.anchor.updateWorldMatrix(true, false)
      v.setFromMatrixPosition(e.anchor.matrixWorld).project(camera)
      const hidden = e.alpha < 0.01 || v.z > 1 || v.z < -1
      e.el.style.visibility = hidden ? 'hidden' : 'visible'
      if (hidden) continue
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      e.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
      e.el.style.opacity = e.alpha.toFixed(3)
    }
  })
  return null
}
