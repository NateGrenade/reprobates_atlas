// Living map: character markers at their position at the time cursor, with animated travel paths.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Entity, Location, VaultIndex } from '@core/vault'
import { positionAt, type Position } from '@core/timeline'
import { useStore, vaultUrl } from '../store'
import { registerLabel, updateLabel } from './labels'
import type { FadeRef } from './util'

/** Position of location `x` as seen from level `level` (its own centre, or the child that contains it). */
export function posInLevel(ix: VaultIndex, level: string | null, x: string): THREE.Vector3 | null {
  const chain = ix.ancestry(x)
  if (level === null) {
    const top = chain[0]
    return top ? new THREE.Vector3(...(ix.entities.get(top) as Location).pos) : null
  }
  const i = chain.indexOf(level)
  if (i < 0) return null
  if (i === chain.length - 1) return new THREE.Vector3(0, 6, 0)
  return new THREE.Vector3(...(ix.entities.get(chain[i + 1]) as Location).pos)
}

function portraitTexture(e: Entity): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const ring = () => {
    g.beginPath()
    g.arc(64, 64, 58, 0, Math.PI * 2)
    g.lineWidth = 6
    g.strokeStyle = '#f0c27e'
    g.stroke()
    tex.needsUpdate = true
  }
  const fallback = () => {
    const grd = g.createLinearGradient(0, 0, 128, 128)
    grd.addColorStop(0, '#2b2550')
    grd.addColorStop(1, '#120f22')
    g.fillStyle = grd
    g.beginPath()
    g.arc(64, 64, 58, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffe2b0'
    g.font = '500 56px "Fraunces Variable", Georgia, serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(e.name.slice(0, 1), 64, 68)
    ring()
  }
  fallback()
  if (typeof e.data.portrait === 'string') {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      g.clearRect(0, 0, 128, 128)
      g.save()
      g.beginPath()
      g.arc(64, 64, 58, 0, Math.PI * 2)
      g.clip()
      const s = Math.max(116 / img.width, 116 / img.height)
      g.drawImage(img, 64 - (img.width * s) / 2, 64 - (img.height * s) / 2 - 8, img.width * s, img.height * s)
      g.restore()
      ring()
    }
    img.src = vaultUrl(e.data.portrait)
  }
  return tex
}

const pathVert = `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`
const pathFrag = `uniform float uTime; uniform float uOpacity; uniform float uProgress; varying float vT;
  void main(){ float dash = step(0.5, fract(vT * 14.0 - uTime * 0.8)); float done = step(vT, uProgress);
    vec3 c = mix(vec3(0.94,0.76,0.49), vec3(1.0,0.89,0.69), done); gl_FragColor = vec4(c, uOpacity * (0.25 + 0.6 * done) * (0.35 + 0.65 * dash)); }`

interface Track {
  e: Entity
  tex: THREE.CanvasTexture
  mat: THREE.SpriteMaterial
  sprite: THREE.Sprite | null
  pos: THREE.Vector3 | null
  target: THREE.Vector3 | null
  alpha: number
  shown: boolean
  pathMat: THREE.ShaderMaterial
  path: THREE.Line | null
}

export function Travellers({ ix, level, fade }: { ix: VaultIndex; level: string | null; fade: FadeRef }) {
  const chars = useMemo(() => [...ix.entities.values()].filter((e) => e.type === 'character'), [ix])
  const group = useRef<THREE.Group>(null)
  const tracks = useMemo(
    () =>
      chars.map<Track>((e) => {
        const tex = portraitTexture(e)
        return {
          e,
          tex,
          mat: new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }),
          sprite: null,
          pos: null,
          target: null,
          alpha: 0,
          shown: false,
          pathMat: new THREE.ShaderMaterial({ vertexShader: pathVert, fragmentShader: pathFrag, uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uProgress: { value: 0 } }, transparent: true, depthWrite: false }),
          path: null
        }
      }),
    // portrait path changes rebuild the texture
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chars.map((c) => c.id + c.data.portrait).join('|')]
  )
  const keyFor = (t: Track) => `trav:${level ?? 'u'}:${t.e.id}`
  useEffect(() => {
    const offs = tracks.map((t) => registerLabel({ key: keyFor(t), name: t.e.name, kind: 'character', importance: 0.2, selected: false, anchor: null, alpha: 0, el: null }))
    return () => offs.forEach((o) => o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, level])

  useFrame(({ clock }, dt) => {
    const t = useStore.getState().timeCursor
    const sel = useStore.getState().selected
    const k = 1 - Math.exp(-dt * 7)
    const debug: Record<string, unknown> = {}
    tracks.forEach((tr, idx) => {
      const p: Position = positionAt(ix, tr.e.id, t)
      let target: THREE.Vector3 | null = null
      let visible = false
      let pathPts: THREE.Vector3[] | null = null
      let progress = 0
      if (p.kind === 'at') {
        target = posInLevel(ix, level, p.location)
        visible = !!target
      } else if (p.kind === 'transit') {
        const a = posInLevel(ix, level, p.from)
        const b = p.to ? posInLevel(ix, level, p.to) : null
        if (a && b && a.distanceTo(b) > 0.5) {
          const mid = a.clone().add(b).multiplyScalar(0.5)
          mid.y += a.distanceTo(b) * 0.35
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
          progress = Math.min(1, Math.max(0, p.progress ?? 0))
          target = curve.getPoint(progress)
          pathPts = curve.getPoints(64)
          visible = true
        } else if (a) {
          // leaving with no known destination in this view: drift away from the place
          target = a.clone().add(new THREE.Vector3(6, 4, 6))
          visible = true
        }
      }
      // spread characters sharing a spot
      if (target) target.add(new THREE.Vector3(Math.cos(idx * 2.4) * 3.2, 3 + (idx % 3), Math.sin(idx * 2.4) * 3.2))
      if (target) tr.target = target
      if (!tr.pos && tr.target) tr.pos = tr.target.clone()
      if (tr.pos && tr.target) tr.pos.lerp(tr.target, k)
      const transit = p.kind === 'transit'
      tr.alpha += ((visible ? (transit ? 0.75 : 1) : 0) - tr.alpha) * k
      const a = tr.alpha * fade.current
      tr.mat.opacity = a
      tr.shown = a > 0.3 && !!tr.pos
      if (tr.sprite) {
        // a traveller with no position (or faded out) must not be a click target: scale 0 and hidden
        if (tr.pos) tr.sprite.position.copy(tr.pos)
        const s = tr.pos && a > 0.01 ? (sel === tr.e.id ? 0.062 : 0.05) : 0
        tr.sprite.scale.set(s, s, 1)
        tr.sprite.visible = s > 0
      }
      // path
      if (pathPts) {
        const g = new THREE.BufferGeometry().setFromPoints(pathPts)
        g.setAttribute('aT', new THREE.Float32BufferAttribute(pathPts.map((_, i) => i / (pathPts!.length - 1)), 1))
        if (tr.path) {
          tr.path.geometry.dispose()
          tr.path.geometry = g
        } else if (group.current) {
          tr.path = new THREE.Line(g, tr.pathMat)
          group.current.add(tr.path)
        }
      }
      tr.pathMat.uniforms.uOpacity.value = (pathPts ? 1 : 0) * fade.current
      tr.pathMat.uniforms.uProgress.value = progress
      tr.pathMat.uniforms.uTime.value = clock.elapsedTime
      updateLabel(keyFor(tr), { alpha: sel === tr.e.id ? a : 0, anchor: tr.sprite, selected: sel === tr.e.id })
      debug[tr.e.name] = { kind: p.kind, visible, at: p.kind === 'at' ? p.location : p.kind === 'transit' ? p.from : null, pos: tr.pos?.toArray().map((x) => Math.round(x)) }
    })
    if (fade.current > 0.5) (window as any).__atlasTravellers = debug
  })

  return (
    <group ref={group}>
      {tracks.map((tr) => (
        <sprite
          key={tr.e.id}
          ref={(s) => void (tr.sprite = s)}
          material={tr.mat}
          renderOrder={20}
          scale={0}
          visible={false}
          onClick={(ev) => {
            if (!tr.shown) return
            ev.stopPropagation()
            useStore.getState().select(tr.e.id)
          }}
        />
      ))}
    </group>
  )
}
