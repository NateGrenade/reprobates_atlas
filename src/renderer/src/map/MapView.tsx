// Nested map. Each level is its own scene in its own units (radius 100). Moving between a level and a child
// level scales the parent up around the child while the child grows out of its marker, with a cross-fade:
// no single coordinate system ever spans galaxy-to-room scales.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStore } from '../store'
import { removeLocation } from './removeLocation'
import type { Location, VaultIndex } from '@core/vault'
import { validateSceneText, type SceneSpec } from '@core/scene'
import { Backdrop } from './presets'
import { Level, levelBodyScale, levelSpec, placeRequest, dragState, type LevelSpec, type PlaceRequest } from './Level'
import { MAP_KINDS, MAP_KIND_LABEL, type MapKind } from '@core/vault'
import { yamlValue } from '@core/note'
import { LabelLayer, LabelProjector } from './labels'
import { Scrubber } from './Scrubber'
import { DEFAULT_SIZE, drawnSize, easeInOutCubic, easeOutCubic, smoothstep, type FadeRef } from './util'

type LevelId = string | null

/** The level the map opens on: atlas.yaml root_location, else the single top-level location, else the universe. */
export function rootLevel(ix: VaultIndex): LevelId {
  const r = ix.config.root_location ? ix.resolveEntity(String(ix.config.root_location)) : null
  if (r) return r
  const tops = ix.children(null)
  return tops.length === 1 ? tops[0] : null
}

const parentOf = (ix: VaultIndex, id: LevelId): LevelId => (id ? ((ix.entities.get(id) as Location | undefined)?.parent ?? null) : null)
const sizeOf = (ix: VaultIndex, id: string) => {
  const l = ix.entities.get(id) as Location
  return l.size ?? DEFAULT_SIZE[l.kind] ?? 5
}

/** Path of adjacent steps from a to b (up to the common ancestor, then down). */
function pathBetween(ix: VaultIndex, a: LevelId, b: LevelId): LevelId[] {
  const chain = (x: LevelId) => (x ? [null, ...ix.ancestry(x)] : [null])
  const ca = chain(a), cb = chain(b)
  let i = 0
  while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++
  return [...ca.slice(i - 1, ca.length).reverse(), ...cb.slice(i)]
}

interface Step { parent: LevelId; child: string; dir: 'in' | 'out' }

export function MapView() {
  const ix = useStore((s) => s.index)!
  const files = useStore((s) => s.files)
  const focus = useStore((s) => s.mapFocus)
  const setFocus = useStore((s) => s.setMapFocus)
  const select = useStore((s) => s.select)
  const root = useMemo(() => rootLevel(ix), [ix])
  const target: LevelId = focus === undefined || (focus !== null && !ix.entities.has(focus)) ? root : focus
  const [shown, setShown] = useState<LevelId>(target)
  // Atlas Live waits on this to know the fly-through has arrived (src/renderer/src/live.ts)
  useEffect(() => void ((window as any).__atlasMapShown = shown), [shown])
  const hovered = useRef<string | null>(null)
  const busy = useRef(false)

  const preview = useStore((s) => s.scenePreview)
  const specs = useMemo(() => {
    const m = new Map<LevelId, LevelSpec>()
    const get = (id: LevelId) => {
      if (!m.has(id)) m.set(id, levelSpec(ix, files, id, id ? preview[id] : undefined))
      return m.get(id)!
    }
    return get
  }, [ix, files, preview])

  const crumbs = useMemo(() => {
    const ids = shown ? ix.ancestry(shown) : []
    // the top level ("Known space") is always the first crumb, so anything can be placed above a galaxy
    return [{ id: null as LevelId, name: 'Known space' }, ...ids.map((id) => ({ id: id as LevelId, name: ix.entities.get(id)?.name ?? id }))]
  }, [ix, shown])

  const flyOut = () => {
    if (busy.current || !shown) return
    setFocus(parentOf(ix, shown))
  }
  const flyIn = (id: string) => {
    if (busy.current) return
    select(id)
    setFocus(id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const st = useStore.getState()
      if (st.settingsOpen || st.calendarsOpen || st.paletteOpen) return // a dialog on top owns the keys
      if (e.key === 'Escape') flyOut()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useStore.getState().selected
        const loc = sel ? ix.entities.get(sel) : undefined
        if (loc?.type === 'location') void removeLocation(loc as Location)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Dev: ATLAS_AUTOZOOM=1 flies root -> child -> grandchild -> back and logs frame timing.
  useEffect(() => {
    if (!window.atlas.devFlags?.autozoom || !root) return
    const kid = ix.children(root).find((c) => ix.children(c).length > 0)
    const grand = kid ? ix.children(kid)[0] : undefined
    if (!kid || !grand) return
    const dts: number[] = []
    let last = 0, raf = 0, rec = false
    const t0 = performance.now()
    const long: string[] = []
    const loop = (t: number) => {
      if (rec && last) dts.push(t - last)
      if (rec && last && t - last > 33) long.push(`${((t - t0) / 1000).toFixed(2)}s:${(t - last).toFixed(0)}ms`)
      last = t
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const plan: [number, () => void][] = [
      [2500, () => ((rec = true), setFocus(kid))],
      [5000, () => setFocus(grand)],
      [7500, () => setFocus(kid)],
      [10000, () => setFocus(root)],
      [12500, () => {
        rec = false
        const sorted = [...dts].sort((a, b) => a - b)
        const avg = dts.length / (dts.reduce((a, b) => a + b, 0) / 1000)
        console.log(`[autozoom] frames=${dts.length} avgFps=${avg.toFixed(1)} p99FrameMs=${sorted[Math.floor(sorted.length * 0.99)].toFixed(1)} worstFrameMs=${sorted[sorted.length - 1].toFixed(1)} over33ms=${dts.filter((d) => d > 33).length} canvas=${document.querySelector('canvas')?.width}x${document.querySelector('canvas')?.height} long=[${long.join(' ')}]`)
      }]
    ]
    const timers = plan.map(([ms, fn]) => setTimeout(fn, ms))
    return () => {
      timers.forEach(clearTimeout)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shownLoc = shown ? (ix.entities.get(shown) as Location | undefined) : undefined
  const spec = specs(shown)
  const edit = useStore((s) => s.mapEdit)
  const armedKind = useStore((s) => s.armedKind)
  const setEdit = useStore((s) => s.setMapEdit)
  const [place, setPlace] = useState<PlaceRequest | null>(null)
  useEffect(() => {
    placeRequest.current = (r) => (r.level === shown ? setPlace(r) : null)
    return () => void (placeRequest.current = null)
  }, [shown])

  return (
    <div className="map-root">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
        camera={{ fov: 40, near: 0.5, far: 6000, position: [0, 150, 170] }}
        onPointerMissed={() => {}}
      >
        <color attach="background" args={['#06050c']} />
        <Backdrop />
        <Director
          ix={ix}
          target={target}
          shown={shown}
          setShown={setShown}
          specs={specs}
          busy={busy}
          hovered={hovered}
          onFlyIn={flyIn}
          onFlyOut={flyOut}
        />
        <LabelProjector />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.12} luminanceSmoothing={0.35} radius={0.78} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.28} darkness={0.62} />
        </EffectComposer>
      </Canvas>

      <LabelLayer />
      <div className="map-hud">
        <div className="crumbs" style={{ marginLeft: 0 }}>
          <button className={`map-edit-btn${edit ? ' on' : ''}`} onClick={() => setEdit(!edit)} title="Add and move places">
            {edit ? 'Done editing' : 'Edit map'}
          </button>
          {edit && <AddMenu />}
          {crumbs.map((c, i) => (
            <span key={c.id ?? '__top'} style={{ display: 'contents' }}>
              {i > 0 && <span className="crumb-sep">/</span>}
              <button className={`crumb${i === crumbs.length - 1 ? ' current' : ''}`} onClick={() => setFocus(c.id)}>
                {c.name}
              </button>
            </span>
          ))}
        </div>
      </div>
      {spec.error && (
        <div className="map-error">
          Scene file problem in {spec.error.file} (line {spec.error.line}): {spec.error.message}. Showing the default look.
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={shown ?? 'universe'}
          className="map-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
        >
          <div className="k">{shownLoc ? shownLoc.kind : 'Atlas'}</div>
          <div className="t">{shownLoc?.name ?? 'Known space'}</div>
        </motion.div>
      </AnimatePresence>
      <Scrubber ix={ix} />
      <div className="map-hint">
        {edit ? (
          <>
            {armedKind ? `Click where the ${MAP_KIND_LABEL[armedKind].toLowerCase()} should go` : 'Add… picks what to place; click the ground to place it · drag a place to move it'}
            <br />
            Select a place, then drag its gold handle up or down to lift it, or type X / Y / Z in the Inspector
          </>
        ) : (
          <>
            Click to select · double-click or scroll in to enter
            <br />
            <kbd>Esc</kbd> or scroll out to leave
          </>
        )}
      </div>
      <AnimatePresence>{place && <PlaceDialog req={place} ix={ix} onClose={() => setPlace(null)} />}</AnimatePresence>
    </div>
  )
}

const NEXT_KIND: Partial<Record<MapKind, MapKind>> = { universe: 'galaxy', galaxy: 'system', region: 'system', system: 'planet', planet: 'city', gas_giant: 'moon', moon: 'city', continent: 'city', city: 'building', district: 'building', building: 'room', room: 'other' }

function AddMenu() {
  const armed = useStore((s) => s.armedKind)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = MAP_KINDS.filter((k) => !q || MAP_KIND_LABEL[k].toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="pop-wrap add-kind">
      <button className={`map-edit-btn${open || armed ? ' on' : ''}`} onClick={() => setOpen(!open)}>
        {armed ? `Placing: ${MAP_KIND_LABEL[armed]}` : 'Add…'}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="pop add-pop" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <input className="field-input" autoFocus placeholder="Star, moon, asteroid belt, city…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && list[0] && (useStore.getState().setArmedKind(list[0]), setOpen(false))} />
            <div className="lane-list">
              {list.map((k) => (
                <button key={k} className="lane-opt add-kind-opt" onClick={() => (useStore.getState().setArmedKind(k), setOpen(false), setQ(''))}>
                  {MAP_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PlaceDialog({ req, ix, onClose }: { req: PlaceRequest; ix: VaultIndex; onClose(): void }) {
  const parent = req.level ? (ix.entities.get(req.level) as Location) : null
  const [name, setName] = useState('')
  const [kind, setKind] = useState<MapKind>((useStore.getState().armedKind as MapKind) || (parent && NEXT_KIND[parent.kind]) || 'region')
  const [size, setSize] = useState(6)
  const [err, setErr] = useState<string | null>(null)
  const create = async () => {
    const n = name.trim()
    if (!n || /[\\/:*?"<>|#^\[\]]/.test(n)) return setErr('Use a plain name.')
    const path = `Atlas/Places/${n}.md`
    const lines = ['---', 'type: location']
    if (parent) lines.push(`parent: ${yamlValue(`[[${parent.name}]]`)}`)
    lines.push(`map_kind: ${kind}`, `map_pos: ${yamlValue(req.pos)}`, `map_size: ${size}`, '---', '')
    const text = lines.join('\n')
    try {
      await window.atlas.create(path, text)
      useStore.getState().applyChanges([[path, text]])
      useStore.getState().select(path)
      useStore.getState().setArmedKind(null)
      onClose()
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <motion.form
      className="place-dialog"
      style={{ left: Math.min(req.x, window.innerWidth - 340), top: Math.min(req.y, window.innerHeight - 240) }}
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onSubmit={(e) => (e.preventDefault(), create())}
    >
      <div className="pd-title">New place{parent ? ` in ${parent.name}` : ''}</div>
      <input className="field-input" autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      <div className="pd-row">
        <select className="field-select" value={kind} onChange={(e) => setKind(e.target.value as MapKind)}>
          {MAP_KINDS.map((k) => (
            <option key={k} value={k}>
              {MAP_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="pd-size">
          size
          <input className="field-input" type="number" min={0.5} step={0.5} value={size} onChange={(e) => setSize(Number(e.target.value) || 6)} />
        </label>
      </div>
      <div className="pd-foot">
        <span className="muted">Atlas/Places/{name || '…'}.md</span>
        <span>
          <button type="button" className="chip-btn" onClick={onClose}>
            Cancel
          </button>{' '}
          <button type="submit" className="chip-btn primary">
            Add place
          </button>
        </span>
      </div>
      {err && <div className="add-err" style={{ padding: '6px 0 0' }}>{err}</div>}
    </motion.form>
  )
}

const CAMERA: Record<string, { r: number; polar: number; min: number; max: number }> = {
  galaxy: { r: 215, polar: 0.98, min: 50, max: 420 },
  system: { r: 205, polar: 1.08, min: 45, max: 420 },
  planet: { r: 150, polar: 1.25, min: 62, max: 380 },
  generic: { r: 220, polar: 0.95, min: 45, max: 420 },
  terrain: { r: 190, polar: 0.92, min: 40, max: 400 },
  city: { r: 170, polar: 0.95, min: 30, max: 380 },
  plan: { r: 180, polar: 0.6, min: 30, max: 380 },
  model: { r: 200, polar: 1.05, min: 30, max: 420 }
}

interface DirectorProps {
  ix: VaultIndex
  target: LevelId
  shown: LevelId
  setShown(id: LevelId): void
  specs(id: LevelId): LevelSpec
  busy: React.MutableRefObject<boolean>
  hovered: React.MutableRefObject<string | null>
  onFlyIn(id: string): void
  onFlyOut(): void
}

/** Owns the mounted levels, the transition maths and the camera. */
function Director({ ix, target, shown, setShown, specs, busy, hovered, onFlyIn, onFlyOut }: DirectorProps) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, gl } = useThree()
  const reduced = useStore((s) => s.reducedMotion)
  const selected = useStore((s) => s.selected)
  // mounted levels: [id, fade, group]
  const [mounted, setMounted] = useState<LevelId[]>([shown])
  const fades = useRef(new Map<LevelId, FadeRef>([[shown, { current: 1 }]]))
  const groups = useRef(new Map<LevelId, THREE.Group>())
  const queue = useRef<Step[]>([])
  const anim = useRef<{ step: Step; t: number; dur: number; cam0: THREE.Spherical; cam1: THREE.Spherical } | null>(null)
  const overscroll = useRef(0)
  // Neighbouring levels are mounted ahead of time and drawn invisibly for a few frames so their
  // geometry is built and shaders compiled before any transition (no hitch when flying).
  const [warm, setWarm] = useState<LevelId[]>([])
  useEffect(() => {
    // add one neighbour at a time so no single frame pays for several levels
    const ids: LevelId[] = []
    if (shown !== null) ids.push(parentOf(ix, shown))
    ids.push(...ix.children(shown).slice(0, 8))
    const want = ids.filter((x) => x !== shown)
    setWarm((w) => w.filter((x) => want.includes(x)))
    const timers = want.map((id, i) => setTimeout(() => setWarm((w) => (w.includes(id) ? w : [...w, id])), 250 + i * 180))
    return () => timers.forEach(clearTimeout)
  }, [ix, shown])
  const warmFrames = useRef(new Map<LevelId, number>())

  const fadeOf = (id: LevelId) => {
    let f = fades.current.get(id)
    if (!f) fades.current.set(id, (f = { current: 0 }))
    return f
  }
  const camFor = (id: LevelId) => CAMERA[specs(id).preset] ?? CAMERA.generic

  // New target: plan the steps.
  useEffect(() => {
    const cur = anim.current ? (anim.current.step.dir === 'in' ? anim.current.step.child : anim.current.step.parent) : shown
    if (target === cur && !anim.current) return
    const path = pathBetween(ix, cur, target)
    const steps: Step[] = []
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1]
      if (b !== null && parentOf(ix, b) === a) steps.push({ parent: a, child: b, dir: 'in' })
      else if (a !== null) steps.push({ parent: b, child: a, dir: 'out' })
    }
    queue.current = steps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ix])

  // Initial camera
  useEffect(() => {
    const c = camFor(shown)
    camera.position.setFromSpherical(new THREE.Spherical(c.r, c.polar, 0.6))
    camera.lookAt(0, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Overscroll to enter / leave
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      if (busy.current || !controls.current) return
      const c = camFor(shown)
      const d = camera.position.length()
      if (e.deltaY < 0 && d <= c.min * 1.05) {
        overscroll.current += -e.deltaY
        const cand = hovered.current ?? (selected && parentOf(ix, selected) === shown ? selected : null)
        if (overscroll.current > 220 && cand) {
          overscroll.current = 0
          onFlyIn(cand)
        }
      } else if (e.deltaY > 0 && d >= c.max * 0.95) {
        overscroll.current += e.deltaY
        if (overscroll.current > 220) {
          overscroll.current = 0
          onFlyOut()
        }
      } else overscroll.current = 0
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const startNext = () => {
    const step = queue.current.shift()
    if (!step) return false
    const from = step.dir === 'in' ? step.parent : step.child
    const to = step.dir === 'in' ? step.child : step.parent
    fadeOf(step.parent)
    fadeOf(step.child)
    setMounted([step.parent, step.child])
    const cam0 = new THREE.Spherical().setFromVector3(camera.position)
    const c1 = camFor(to)
    let theta1 = cam0.theta + (step.dir === 'in' ? 0.35 : -0.35)
    const light = specs(to).params.__light as number[] | undefined
    if (light) {
      // view a planet from a three-quarter-lit angle so the terminator shows; take the shorter way round
      const want = Math.atan2(light[0], light[2]) + 0.95
      theta1 = cam0.theta + Math.atan2(Math.sin(want - cam0.theta), Math.cos(want - cam0.theta))
    }
    const cam1 = new THREE.Spherical(c1.r, c1.polar, theta1)
    const many = queue.current.length > 0
    anim.current = { step, t: 0, dur: reduced ? 0.01 : many ? 1.1 : 1.65, cam0, cam1 }
    busy.current = true
    if (controls.current) controls.current.enabled = false
    void from
    return true
  }

  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame((_s, dt) => {
    // a level that was removed (or renamed) while shown or mid-flight: drop the flight and snap to the target
    const gone = (id: LevelId) => id !== null && !ix.entities.has(id)
    if (gone(shown) || (anim.current && (gone(anim.current.step.child) || gone(anim.current.step.parent))) || queue.current.some((q) => gone(q.child) || gone(q.parent))) {
      const to = gone(target) ? null : target
      anim.current = null
      queue.current = []
      busy.current = false
      fadeOf(to).current = 1
      const c = camFor(to)
      camera.position.setFromSpherical(new THREE.Spherical(c.r, c.polar, 0.6))
      camera.lookAt(0, 0, 0)
      if (controls.current) {
        controls.current.enabled = true
        controls.current.target.set(0, 0, 0)
        controls.current.update()
      }
      setMounted([to])
      setShown(to)
      return
    }
    if (!anim.current && queue.current.length) startNext()
    const a = anim.current
    const activeIds = a ? [a.step.parent, a.step.child] : [shown]
    for (const id of warm) {
      if (activeIds.includes(id)) continue
      const g = groups.current.get(id)
      if (!g) continue
      const n = (warmFrames.current.get(id) ?? 0) + 1
      warmFrames.current.set(id, n)
      g.scale.setScalar(1e-4)
      g.position.set(0, 0, 0)
      fadeOf(id).current = n < 4 ? 0.004 : 0
    }
    if (!a) {
      if (controls.current) controls.current.enabled = !dragState.active
      // idle: the shown level sits at identity
      const g = groups.current.get(shown)
      if (g) {
        g.position.set(0, 0, 0)
        g.scale.setScalar(1)
      }
      fadeOf(shown).current = 1
      return
    }
    a.t = Math.min(1, a.t + Math.min(dt, 1 / 30) / a.dur)
    const k = easeInOutCubic(a.t)
    const u = a.step.dir === 'in' ? k : 1 - k
    const { parent, child } = a.step
    const childLoc = ix.entities.get(child) as Location
    const c = new THREE.Vector3(...childLoc.pos)
    const sigma = drawnSize(sizeOf(ix, child), levelBodyScale(specs(parent)))
    const S = 100 / sigma
    const w = smoothstep(0, 1, u)
    const s = Math.exp(Math.log(S) * w)
    const fk = easeOutCubic(u / 0.72)
    tmp.copy(c).multiplyScalar(fk) // focus point in parent units
    const gp = groups.current.get(parent)
    const gc = groups.current.get(child)
    if (gp) {
      gp.scale.setScalar(s)
      gp.position.copy(tmp).multiplyScalar(-s)
    }
    if (gc) {
      gc.scale.setScalar((s * sigma) / 100)
      gc.position.copy(c).sub(tmp).multiplyScalar(s)
    }
    fadeOf(parent).current = 1 - smoothstep(0.5, 0.92, u)
    fadeOf(child).current = smoothstep(0.28, 0.78, u)
    // camera: log-radius and angle interpolation toward the destination framing
    const r = Math.exp(THREE.MathUtils.lerp(Math.log(a.cam0.radius), Math.log(a.cam1.radius), k))
    const sp = new THREE.Spherical(r, THREE.MathUtils.lerp(a.cam0.phi, a.cam1.phi, k), THREE.MathUtils.lerp(a.cam0.theta, a.cam1.theta, k))
    camera.position.setFromSpherical(sp)
    camera.lookAt(0, 0, 0)
    if (a.t >= 1) {
      const to = a.step.dir === 'in' ? child : parent
      anim.current = null
      fadeOf(to).current = 1
      if (!queue.current.length) {
        busy.current = false
        if (controls.current) {
          controls.current.enabled = true
          controls.current.target.set(0, 0, 0)
          controls.current.update()
        }
        setMounted([to])
        setShown(to)
      } else {
        setShown(to)
      }
    }
  })

  const cam = camFor(shown)
  return (
    <>
      <OrbitControls
        ref={controls as any}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.45}
        zoomSpeed={0.6}
        minDistance={cam.min}
        maxDistance={cam.max}
      />
      {[...new Set([...mounted, ...warm])].map((id) => (
        <group key={id ?? '__universe'} ref={(g) => void (g ? groups.current.set(id, g) : groups.current.delete(id))}>
          <Level ix={ix} id={id} spec={specs(id)} fade={fadeOf(id)} hovered={hovered} onEnter={onFlyIn} />
        </group>
      ))}
    </>
  )
}

export type { SceneSpec }
export { validateSceneText }
