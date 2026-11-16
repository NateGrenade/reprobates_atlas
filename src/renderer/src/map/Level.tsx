// One map level: its scene preset plus markers and labels for its child locations.
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { patchFrontmatter } from '@core/note'
import { registerLabel, updateLabel } from './labels'
import * as THREE from 'three'
import type { Location, VaultIndex } from '@core/vault'
import { validateSceneText, type SceneSpec } from '@core/scene'
import { useStore } from '../store'
import { GalaxyPreset, GenericPreset, PlanetPreset, SystemPreset, PLANET_RADIUS } from './presets'
import { Travellers } from './Travellers'
import { CityPreset, Layers, ModelPreset, PlanPreset, TerrainPreset } from './presets2'
import { DEFAULT_SIZE, bodyScale, drawnSize, glowTexture, hashString, smoothstep, rng, starSizeOf, type FadeRef } from './util'

export interface LevelSpec {
  preset: 'galaxy' | 'system' | 'planet' | 'terrain' | 'city' | 'plan' | 'model' | 'generic'
  layers?: Record<string, any>[]
  seed: number
  params: Record<string, any>
  error?: { file: string; line: number; message: string }
}

export const KIND_PRESET: Record<string, LevelSpec['preset']> = { galaxy: 'galaxy', system: 'system', star: 'system', planet: 'planet', gas_giant: 'planet', moon: 'planet', dwarf_planet: 'planet', continent: 'terrain', region: 'terrain', city: 'city', district: 'city', building: 'plan', room: 'plan' }

/** Scene for a level: its .scene.json if valid, else the default for its map_kind. */
export function levelSpec(ix: VaultIndex, files: Map<string, string | null>, id: string | null, preview?: SceneSpec): LevelSpec {
  const loc = id ? (ix.entities.get(id) as Location | undefined) : undefined
  const seed = hashString(id ?? 'universe')
  const light = loc && loc.kind === 'planet' ? [-loc.pos[0] || 1, Math.abs(loc.pos[1]) * 0.2 + 0.25 * Math.hypot(loc.pos[0], loc.pos[2]) * 0.01 + 0.15, -loc.pos[2] || 0.5] : undefined
  const fallback: LevelSpec = { preset: (loc && KIND_PRESET[loc.kind]) || 'generic', seed, params: { ...(loc?.color ? { color: loc.color, star_color: loc.color } : {}), ...(light ? { __light: light } : {}), ...(loc && (loc.kind === 'system' || loc.kind === 'star') ? { __star: loc.size ?? DEFAULT_SIZE[loc.kind] } : {}) } }
  if (preview) return { preset: preview.preset, seed: preview.seed ?? seed, params: { ...fallback.params, ...(preview.params ?? {}) }, layers: preview.layers }
  if (!loc?.scene) return fallback
  const text = files.get(loc.scene)
  if (typeof text !== 'string') return { ...fallback, error: { file: loc.scene, line: 1, message: 'file not found' } }
  const { spec, issues } = validateSceneText(text)
  if (!spec) return { ...fallback, error: { file: loc.scene, line: issues[0].line, message: issues[0].message } }
  return { preset: spec.preset, seed: spec.seed ?? seed, params: { ...fallback.params, ...(spec.params ?? {}) }, layers: spec.layers }
}

interface LevelProps {
  ix: VaultIndex
  id: string | null
  spec: LevelSpec
  fade: FadeRef
  hovered: React.MutableRefObject<string | null>
  onEnter(id: string): void
}

/** How much bodies inside this level are scaled against its star; null outside star systems (sizes used as written). */
export const levelBodyScale = (spec: LevelSpec) => (spec.preset === 'system' ? bodyScale(starSizeOf(spec.params)) : null)

export function Level({ ix, id, spec, fade, hovered, onEnter }: LevelProps) {
  const rel = levelBodyScale(spec)
  const kids = useMemo(() => ix.children(id).map((c) => ix.entities.get(c) as Location), [ix, id])
  const orbits = useMemo(() => (spec.preset === 'system' ? kids.map((k) => Math.hypot(k.pos[0], k.pos[2])) : []), [kids, spec.preset])
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (groupRef.current) groupRef.current.visible = fade.current > 0.003
  })
  const P = { seed: spec.seed, params: spec.params, fade, orbits }
  return (
    <group ref={groupRef}>
      {spec.preset === 'galaxy' && <GalaxyPreset {...P} />}
      {spec.preset === 'system' && <SystemPreset {...P} />}
      {spec.preset === 'planet' && <PlanetPreset {...P} />}
      {spec.preset === 'generic' && <GenericPreset {...P} />}
      {spec.preset === 'terrain' && <TerrainPreset {...P} />}
      {spec.preset === 'city' && <CityPreset {...P} />}
      {spec.preset === 'plan' && <PlanPreset {...P} />}
      {spec.preset === 'model' && <ModelPreset {...P} />}
      {spec.layers && spec.layers.length > 0 && <Layers layers={spec.layers} fade={fade} />}
      <Travellers ix={ix} level={id} fade={fade} />
      <GroundCatcher id={id} preset={spec.preset} fade={fade} />
      {kids.map((k) => (
        <Marker key={k.id} loc={k} rel={rel} levelKey={id ?? 'universe'} parentPreset={spec.preset} fade={fade} hovered={hovered} onEnter={onEnter} companions={ix.children(k.id).map((c) => ix.entities.get(c) as Location).filter((c) => SMALL_BODIES.has(c.kind))} />
      ))}
    </group>
  )
}

/** In map edit mode, clicking the level's ground (or a planet's surface) asks to add a place there. */
function GroundCatcher({ id, preset, fade }: { id: string | null; preset: string; fade: FadeRef }) {
  const edit = useStore((s) => s.mapEdit)
  if (!edit) return null
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (fade.current < 0.99) return
    e.stopPropagation()
    const p = e.point.clone()
    if (preset === 'planet') p.setLength(PLANET_RADIUS + 2)
    placeRequest.current?.({ level: id, pos: [p.x, p.y, p.z].map((v) => Math.round(v * 10) / 10) as [number, number, number], x: e.nativeEvent.clientX, y: e.nativeEvent.clientY })
  }
  return preset === 'planet' ? (
    <mesh onClick={onClick}>
      <sphereGeometry args={[PLANET_RADIUS, 48, 32]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  ) : (
    <mesh rotation-x={-Math.PI / 2} onClick={onClick}>
      <circleGeometry args={[100, 64]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export interface PlaceRequest { level: string | null; pos: [number, number, number]; x: number; y: number }
export const placeRequest: { current: ((r: PlaceRequest) => void) | null } = { current: null }
;(window as any).__atlasPlace = placeRequest // test hook (scripted checks)
export const dragState = { active: false }

const KIND_COLOR: Record<string, string> = { galaxy: '#f0c27e', system: '#ffd59a', star: '#ffe0a8', planet: '#6f9fd0', gas_giant: '#d9a46b', moon: '#b9b6c4', dwarf_planet: '#a59a8e', asteroid: '#8d8478', asteroid_belt: '#9a9184', comet: '#bfe6ff', ring: '#d8c9a8', station: '#e8f0ff', nebula: '#ff8fc0', black_hole: '#ff9a4a', city: '#ffcf8a', region: '#b9a8ff' }
const SPHERE_KINDS = new Set(['planet', 'gas_giant', 'moon', 'dwarf_planet'])
const SMALL_BODIES = new Set(['moon', 'dwarf_planet', 'asteroid', 'station', 'comet'])

/** Displayed position: map_pos tilted about X by map_inclination. */
export const displayPos = (l: Location) => {
  const v = new THREE.Vector3(...l.pos)
  if (l.inclination) v.applyAxisAngle(new THREE.Vector3(1, 0, 0), (l.inclination * Math.PI) / 180)
  return v
}

function Marker({ loc, rel = null, levelKey, parentPreset, fade, hovered, onEnter, companions = [] }: { loc: Location; rel?: number | null; levelKey: string; companions?: Location[]; parentPreset: string; fade: FadeRef; hovered: React.MutableRefObject<string | null>; onEnter(id: string): void }) {
  const select = useStore((s) => s.select)
  const selected = useStore((s) => s.selected) === loc.id
  const [hover, setHover] = useState(false)
  const edit = useStore((s) => s.mapEdit)
  const [dragPos, setDragPos] = useState<THREE.Vector3 | null>(null)
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -loc.pos[1]), [loc.pos])
  const onDragMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragPos) return
    e.stopPropagation()
    const hit = new THREE.Vector3()
    if (parentPreset === 'planet') {
      const r = Math.hypot(...loc.pos)
      const s = new THREE.Sphere(new THREE.Vector3(), r)
      if (e.ray.intersectSphere(s, hit)) setDragPos(hit.clone())
    } else if (e.ray.intersectPlane(dragPlane, hit)) {
      if (hit.length() > 100) hit.setLength(100)
      setDragPos(hit.clone())
    }
  }
  const onDragEnd = async (e: ThreeEvent<PointerEvent>) => {
    if (!dragPos) return
    e.stopPropagation()
    ;(e.target as any)?.releasePointerCapture?.(e.pointerId)
    dragState.active = false
    const raw = dragPos.clone()
    if (loc.inclination) raw.applyAxisAngle(new THREE.Vector3(1, 0, 0), (-loc.inclination * Math.PI) / 180)
    const p = raw.toArray().map((v) => Math.round(v * 10) / 10)
    setDragPos(null)
    const st = useStore.getState()
    const cur = st.files.get(loc.id)
    if (typeof cur === 'string') await st.writeFile(loc.id, patchFrontmatter(cur, 'map_pos', p))
  }
  const sigma = drawnSize(loc.size ?? DEFAULT_SIZE[loc.kind] ?? 5, rel)
  const color = useMemo(() => new THREE.Color(loc.color ?? KIND_COLOR[loc.kind] ?? '#c9c2ff'), [loc.color, loc.kind])
  const importance = Math.min(1, Math.max(0.35, sigma / 9))
  const anchorRef = useRef<THREE.Object3D>(null)
  const labelKey = `${levelKey}/${loc.id}`
  const ringRef = useRef<THREE.Mesh>(null)
  const basePos = useMemo(() => displayPos(loc), [loc.pos, loc.inclination])
  const pos = dragPos ?? basePos
  const world = useMemo(() => new THREE.Vector3(), [])
  const asPlanet = SPHERE_KINDS.has(loc.kind) && parentPreset !== 'galaxy'

  const mats = useMemo(() => {
    const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const core = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffffff').lerp(color, 0.3).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const ring = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f0c27e').multiplyScalar(1.4), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    const planet = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uOpacity: { value: 1 }, uLight: { value: new THREE.Vector3(-1, 0.2, -0.3).normalize() } },
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform vec3 uLight; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 L = normalize(-vW); float d = max(0.0, dot(vN, L)); float rim = pow(1.0 - abs(dot(vN, normalize(cameraPosition - vW))), 3.0);
          gl_FragColor = vec4(uColor * (0.16 + 1.1 * d) + vec3(0.5,0.7,1.0) * rim * 0.5 * d, uOpacity); }`,
      transparent: true
    })
    return { glow, core, ring, planet }
  }, [color])

  useEffect(
    () => registerLabel({ key: labelKey, name: loc.name, kind: loc.kind, importance, selected: false, anchor: anchorRef.current, alpha: 0, el: null }),
    [labelKey, loc.name, loc.kind, importance]
  )

  useFrame(({ camera, clock }) => {
    const f = fade.current
    const active = hover || selected
    mats.glow.opacity = f * (active ? 1 : 0.75)
    mats.core.opacity = f
    mats.planet.uniforms.uOpacity.value = f
    mats.planet.depthWrite = f > 0.98
    if (ringRef.current) {
      ringRef.current.quaternion.copy(camera.quaternion)
      const pulse = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.04
      ringRef.current.scale.setScalar(pulse)
      mats.ring.opacity = f * (selected ? 0.9 : hover ? 0.45 : 0)
    }
    if (anchorRef.current) {
      anchorRef.current.getWorldPosition(world)
      const d = world.distanceTo(camera.position)
      const legible = smoothstep(0.3, 0.75, (importance * 260) / d)
      updateLabel(labelKey, { alpha: f * Math.max(legible, active ? 1 : 0), selected })
    }
  })

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover(true)
    hovered.current = loc.id
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    setHover(false)
    if (hovered.current === loc.id) hovered.current = null
    document.body.style.cursor = ''
  }
  const visual = asPlanet ? sigma * (PLANET_RADIUS / 100) : sigma
  const ringR = asPlanet ? visual * 1.6 : Math.max(2.2, sigma * 0.55)

  const k = loc.kind
  const orbitR = Math.hypot(loc.pos[0], loc.pos[2])
  const orbiting = parentPreset === 'planet' || parentPreset === 'system'
  const bodyInParent = (
    <>
      {asPlanet ? (
        <mesh material={mats.planet}>
          <sphereGeometry args={[visual, 48, 32]} />
        </mesh>
      ) : k === 'asteroid' ? (
        <mesh material={mats.planet}>
          <icosahedronGeometry args={[Math.max(0.6, sigma * 0.4), 0]} />
        </mesh>
      ) : k === 'station' ? (
        <>
          <mesh material={mats.planet}>
            <octahedronGeometry args={[Math.max(0.6, sigma * 0.45), 0]} />
          </mesh>
          <sprite material={mats.core} scale={[sigma * 0.9, sigma * 0.9, 1]} />
        </>
      ) : k === 'black_hole' ? (
        <BlackHole size={sigma} color={color} fade={fade} />
      ) : k === 'nebula' ? (
        <sprite material={mats.glow} scale={[sigma * 5, sigma * 5, 1]} />
      ) : k === 'comet' ? (
        <>
          <sprite material={mats.core} scale={[sigma * 0.6, sigma * 0.6, 1]} />
          <sprite material={mats.glow} scale={[sigma * 4, sigma * 1.1, 1]} position={[sigma * 1.6, 0, 0]} />
        </>
      ) : k === 'asteroid_belt' || k === 'ring' ? (
        <sprite material={mats.core} scale={[sigma * 0.4, sigma * 0.4, 1]} />
      ) : (
        <>
          <sprite material={mats.glow} scale={[sigma * 2.6, sigma * 2.6, 1]} />
          <sprite material={mats.core} scale={[sigma * 0.55, sigma * 0.55, 1]} />
        </>
      )}
    </>
  )

  return (
    <>
    {/* belts and planetary rings circle the level's centre at the body's distance */}
    {(k === 'asteroid_belt' || k === 'ring') && <BeltOrRing radius={orbitR || 30} width={Math.max(1, sigma)} kind={k} color={color} fade={fade} />}
    {orbiting && orbitR > 1 && k !== 'asteroid_belt' && k !== 'ring' && <OrbitLine radius={orbitR} inclination={loc.inclination ?? 0} fade={fade} />}
    {Math.abs(pos.y) > 0.5 && <DropLine from={pos} fade={fade} />}
    {companions.length > 0 && asPlanet && (
      <group position={pos} scale={sigma / 100}>
        {companions.map((m) => (
          <mesh key={m.id} position={displayPos(m)}>
            <sphereGeometry args={[Math.max(6, (m.size ?? 2.5) * 0.4 * 40), 16, 12]} />
            <meshBasicMaterial color={m.color ?? KIND_COLOR[m.kind] ?? '#b9b6c4'} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
    )}
    <group position={pos}>
      {bodyInParent}
      {edit && selected && <LiftHandle y={ringR * 1.6} onLift={(dy) => setDragPos(pos.clone().setY(Math.round((pos.y + dy) * 10) / 10))} onDone={() => onDragEnd({ stopPropagation() {}, target: null, pointerId: 0 } as any)} />}
      <mesh ref={ringRef} material={mats.ring}>
        <ringGeometry args={[ringR, ringR * 1.045, 96]} />
      </mesh>
      <mesh
        visible={false}
        onPointerDown={(e) => {
          // while a kind is armed from Add…, clicks pass through to the ground so a place can go anywhere
          if (!edit || e.button !== 0 || useStore.getState().armedKind) return
          e.stopPropagation()
          ;(e.target as any).setPointerCapture?.(e.pointerId)
          dragState.active = true
          setDragPos(basePos.clone())
          select(loc.id)
        }}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={(e) => {
          if (edit && useStore.getState().armedKind) return
          e.stopPropagation()
          select(loc.id)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onEnter(loc.id)
        }}
      >
        <sphereGeometry args={[Math.max(ringR * 1.1, 3.5), 12, 8]} />
      </mesh>
      <object3D ref={anchorRef} position={[0, ringR * 1.15, 0]} />
    </group>
    </>
  )
}

/**
 * Black hole drawn on a camera-facing quad: a black shadow, a thin photon ring, and an accretion disk whose far
 * side appears bent up over the top of the shadow (the look of gravitational lensing, computed analytically;
 * the stars behind it are not actually refracted, which would need an extra render pass).
 */
const BH_FRAG = /* glsl */ `
  uniform float uTime; uniform float uOpacity; uniform float uTilt; uniform vec3 uColor; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec2 p = vUv * 2. - 1.; float r = length(p); const float rs = 0.2;
    float upness = p.y / max(r, 1e-3);
    // far side of the disk, lensed into a halo that wraps the shadow (brighter over the top)
    float wrap = 0.45 + 0.55 * smoothstep(-0.5, 0.7, upness);
    float halo = smoothstep(rs * 0.99, rs * 1.1, r) * exp(-(r - rs * 1.08) / (rs * 0.42)) * wrap;
    float ring = exp(-pow((r - rs * 1.05) / (rs * 0.04), 2.));
    // the disk itself: a flattened ellipse, flatter the closer the camera is to its plane
    float b = mix(0.09, 0.6, uTilt);
    vec2 q = vec2(p.x, p.y / b); float d = length(q); float qa = atan(q.y, q.x);
    float disk = smoothstep(rs * 1.3, rs * 1.75, d) * (1. - smoothstep(rs * 3.0, rs * 4.6, d));
    float streak = 0.55 + 0.45 * noise(vec2(d * 26., qa * 2.5 - uTime * 0.35 + d * 9.));
    // the near half crosses in front of the shadow, the far half is hidden behind it
    float behind = step(0., p.y) * (1. - smoothstep(rs * 0.96, rs * 1.06, r));
    disk *= (1. - behind) * streak;
    // the side turning toward the viewer is brighter
    float doppler = 0.45 + 0.9 * smoothstep(rs * 4.5, -rs * 4.5, p.x);
    vec3 hot = mix(uColor, vec3(1., 0.95, 0.86), smoothstep(rs * 3.4, rs * 1.4, d));
    vec3 col = uColor * halo * 1.0 + vec3(1., 0.93, 0.8) * ring * 1.5 * wrap + hot * disk * doppler * 1.15;
    float shadow = 1. - smoothstep(rs * 0.97, rs * 1.01, r);
    float a = clamp(max(shadow, max(max(halo, ring * wrap), disk)), 0., 1.);
    gl_FragColor = vec4(col, a * uOpacity);
  }`
function BlackHole({ size, color, fade }: { size: number; color: THREE.Color; fade: FadeRef }) {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uTilt: { value: 0.3 }, uColor: { value: color } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: BH_FRAG,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      }),
    [color]
  )
  const w = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, clock }) => {
    if (!ref.current) return
    ref.current.quaternion.copy(camera.quaternion)
    ref.current.getWorldPosition(w)
    mat.uniforms.uTilt.value = Math.abs(w.sub(camera.position).normalize().y)
    mat.uniforms.uTime.value = clock.elapsedTime
    mat.uniforms.uOpacity.value = fade.current
  })
  return (
    <mesh ref={ref} material={mat} renderOrder={5}>
      <planeGeometry args={[size * 3.4, size * 3.4]} />
    </mesh>
  )
}

function OrbitLine({ radius, inclination, fade }: { radius: number; inclination: number; fade: FadeRef }) {
  const { geo, mat } = useMemo(() => {
    const pts = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * radius, 0, Math.sin((i / 128) * Math.PI * 2) * radius))
    return { geo: new THREE.BufferGeometry().setFromPoints(pts), mat: new THREE.LineBasicMaterial({ color: '#b9b2ff', transparent: true, opacity: 0.12, depthWrite: false }) }
  }, [radius])
  useFrame(() => (mat.opacity = 0.12 * fade.current))
  return <lineLoop geometry={geo} material={mat} rotation-x={(inclination * Math.PI) / 180} />
}

function DropLine({ from, fade }: { from: THREE.Vector3; fade: FadeRef }) {
  const { geo, mat } = useMemo(() => ({ geo: new THREE.BufferGeometry().setFromPoints([from.clone(), new THREE.Vector3(from.x, 0, from.z)]), mat: new THREE.LineDashedMaterial({ color: '#f0c27e', transparent: true, opacity: 0.25, dashSize: 1.2, gapSize: 1.2, depthWrite: false }) }), [from.x, from.y, from.z])
  useEffect(() => void new THREE.Line(geo).computeLineDistances(), [geo])
  useFrame(() => (mat.opacity = 0.25 * fade.current))
  return (
    <group>
      <primitive object={useMemo(() => { const l = new THREE.Line(geo, mat); l.computeLineDistances(); return l }, [geo, mat])} />
      <mesh position={[from.x, 0.05, from.z]} rotation-x={-Math.PI / 2} material={mat}>
        <ringGeometry args={[0.6, 0.8, 24]} />
      </mesh>
    </group>
  )
}

function BeltOrRing({ radius, width, kind, color, fade }: { radius: number; width: number; kind: string; color: THREE.Color; fade: FadeRef }) {
  const { geo, mat } = useMemo(() => {
    if (kind === 'ring') return { geo: new THREE.RingGeometry(radius - width / 2, radius + width / 2, 128), mat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }) }
    const r = rng(Math.round(radius * 100))
    const pos: number[] = []
    for (let i = 0; i < 1400; i++) {
      const a = r() * Math.PI * 2, d = radius + (r() - 0.5) * width * 2
      pos.push(Math.cos(a) * d, (r() - 0.5) * width * 0.3, Math.sin(a) * d)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return { geo: g, mat: new THREE.PointsMaterial({ color, size: 0.5, transparent: true, opacity: 0.8, depthWrite: false }) }
  }, [radius, width, kind, color])
  useFrame(() => (mat.opacity = (kind === 'ring' ? 0.35 : 0.8) * fade.current))
  return kind === 'ring' ? <mesh geometry={geo} material={mat} rotation-x={-Math.PI / 2} /> : <points geometry={geo} material={mat} />
}

/** Vertical drag handle shown above the selected body in edit mode: drag up/down to lift it off the plane. */
function LiftHandle({ y, onLift, onDone }: { y: number; onLift(dy: number): void; onDone(): void }) {
  const start = useRef<{ y: number; plane: THREE.Plane; base: number } | null>(null)
  const { camera } = useThree()
  return (
    <group position={[0, y, 0]}>
      <mesh
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.target as any).setPointerCapture?.(e.pointerId)
          const n = new THREE.Vector3().subVectors(camera.position, e.point).setY(0).normalize()
          start.current = { y: e.point.y, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, e.point), base: 0 }
          dragState.active = true
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          e.stopPropagation()
          const hit = new THREE.Vector3()
          if (e.ray.intersectPlane(start.current.plane, hit)) {
            const dy = hit.y - start.current.y
            onLift(dy - start.current.base)
            start.current.base = dy
          }
        }}
        onPointerUp={(e) => {
          if (!start.current) return
          e.stopPropagation()
          start.current = null
          dragState.active = false
          onDone()
        }}
        userData={{ liftHandle: true }}
      >
        <coneGeometry args={[1.1, 2.4, 16]} />
        <meshBasicMaterial color="#f0c27e" />
      </mesh>
      <mesh position={[0, -2.6, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 2.8, 8]} />
        <meshBasicMaterial color="#f0c27e" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

export type { SceneSpec }
