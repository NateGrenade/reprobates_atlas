// Ground-level presets (terrain, city, plan, model) and the declarative layer primitives.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { rng, gauss, glowTexture, type FadeRef } from './util'
import type { PresetProps } from './presets'
import { vaultUrl } from '../store'

const litVert = /* glsl */ `
  attribute vec3 color;
  varying vec3 vC; varying vec3 vN; varying vec3 vW;
  void main(){ vC = color; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
const litFrag = /* glsl */ `
  uniform float uOpacity; uniform vec3 uLight;
  varying vec3 vC; varying vec3 vN; varying vec3 vW;
  void main(){ float d = max(0.0, dot(normalize(vN), uLight)); float rim = pow(1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 3.0);
    gl_FragColor = vec4(vC * (0.1 + 0.8 * d) + vec3(0.35,0.4,0.6) * rim * 0.25, uOpacity); }`

function litMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: litVert, fragmentShader: litFrag, uniforms: { uOpacity: { value: 1 }, uLight: { value: new THREE.Vector3(0.5, 0.8, 0.35).normalize() } }, transparent: true })
}

/** Keep materials' opacity in step with the level fade. */
function useFade(mats: (THREE.Material & { opacity?: number; uniforms?: any })[], fade: FadeRef, base: number[] = []) {
  useFrame(() => {
    const f = fade.current
    mats.forEach((m, i) => {
      const o = f * (base[i] ?? 1)
      if (m.uniforms?.uOpacity) m.uniforms.uOpacity.value = o
      else m.opacity = o
      m.depthWrite = f > 0.98 && !(m as any).__noDepth
    })
  })
}

function rampColor(ramp: THREE.Color[], t: number, out: THREE.Color) {
  const x = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1)
  const i = Math.floor(x)
  return out.copy(ramp[i]).lerp(ramp[i + 1] ?? ramp[i], x - i)
}

// ---------------------------------------------------------------- terrain

function fbm2(r: () => number) {
  // value-noise fbm from a seeded lattice
  const N = 64
  const grid = Array.from({ length: N * N }, () => r())
  const at = (x: number, y: number) => grid[((y % N) + N) % N * N + (((x % N) + N) % N)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi)
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1)
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
  }
  return (x: number, y: number) => {
    let s = 0, amp = 0.5, f = 1
    for (let o = 0; o < 5; o++) (s += amp * noise(x * f, y * f), (amp *= 0.5), (f *= 2.02))
    return s
  }
}

export function TerrainPreset({ seed, params, fade }: PresetProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!params.heightmap) return setImg(null)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = vaultUrl(params.heightmap)
  }, [params.heightmap])
  const { geo, mat, water } = useMemo(() => {
    const S = 160
    const geo = new THREE.PlaneGeometry(200, 200, S, S)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const height = params.height ?? 18
    let sample: (u: number, v: number) => number
    if (img) {
      const c = document.createElement('canvas')
      c.width = c.height = S + 1
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0, S + 1, S + 1)
      const d = g.getImageData(0, 0, S + 1, S + 1).data
      sample = (u, v) => d[(Math.round(v * S) * (S + 1) + Math.round(u * S)) * 4] / 255
    } else {
      const n = fbm2(rng(seed))
      sample = (u, v) => {
        const r = Math.hypot(u - 0.5, v - 0.5) * 2
        return Math.max(0, n(u * 6, v * 6) * 1.25 - 0.18 - Math.max(0, r - 0.7) * 1.4)
      }
    }
    const ramp = ((params.ramp as string[]) ?? ['#1f3b5c', '#c9b98a', '#5d7a3e', '#3f5530', '#7d7466', '#f2f0ea']).map((c) => new THREE.Color(c))
    const cols = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + 100) / 200, v = (pos.getZ(i) + 100) / 200
      const h = sample(u, v)
      pos.setY(i, h * height)
      rampColor(ramp, h, c)
      cols.set([c.r, c.g, c.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    geo.computeVertexNormals()
    const mat = litMaterial()
    const water = new THREE.MeshBasicMaterial({ color: new THREE.Color(params.water ?? '#16324f'), transparent: true, opacity: 0.6 })
    ;(water as any).__noDepth = true
    return { geo, mat, water }
  }, [seed, params, img])
  useFade([mat, water], fade, [1, 0.6])
  return (
    <group>
      <mesh geometry={geo} material={mat} />
      <mesh material={water} rotation-x={-Math.PI / 2} position-y={(params.height ?? 18) * 0.09}>
        <circleGeometry args={[98, 96]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- city

export function CityPreset({ seed, params, fade }: PresetProps) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const { mat, ground, groundMat, roadMat, blocks, roads } = useMemo(() => {
    const r = rng(seed)
    const blocks: { x: number; z: number; w: number; d: number; h: number }[] = []
    if (Array.isArray(params.footprints) && params.footprints.length) {
      for (const fp of params.footprints as number[][][]) {
        const xs = fp.map((p) => p[0]), zs = fp.map((p) => p[1])
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
        blocks.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 3 + r() * 10 })
      }
    } else {
      const n = params.blocks ?? 14
      const cell = 160 / n
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const x = -80 + (i + 0.5) * cell, z = -80 + (j + 0.5) * cell
          const rr = Math.hypot(x, z)
          if (rr > 82 || r() < 0.22) continue
          const centre = Math.exp(-rr / 38)
          const sub = r() < 0.5 ? 2 : 1
          for (let s = 0; s < sub * sub; s++) {
            const w = (cell * 0.78) / sub, ox = sub === 2 ? ((s % 2) - 0.5) * cell * 0.42 : 0, oz = sub === 2 ? (Math.floor(s / 2) - 0.5) * cell * 0.42 : 0
            blocks.push({ x: x + ox, z: z + oz, w: w * (0.8 + r() * 0.2), d: w * (0.8 + r() * 0.2), h: 1.5 + centre * 22 * (0.4 + r()) + Math.abs(gauss(r)) * 2 })
          }
        }
    }
    const mat = litMaterial()
    const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(params.ground ?? '#121020'), transparent: true })
    const roadMat = new THREE.LineBasicMaterial({ color: new THREE.Color(params.color ?? '#f0c27e'), transparent: true, opacity: 0.18 })
    ;(roadMat as any).__noDepth = true
    const pts: THREE.Vector3[] = []
    const n = params.blocks ?? 14
    for (let i = 0; i <= n; i++) {
      const t = -80 + (i * 160) / n
      const half = Math.sqrt(Math.max(0, 84 * 84 - t * t))
      pts.push(new THREE.Vector3(t, 0.05, -half), new THREE.Vector3(t, 0.05, half), new THREE.Vector3(-half, 0.05, t), new THREE.Vector3(half, 0.05, t))
    }
    return { mat, ground: true, groundMat, roadMat, blocks, roads: new THREE.BufferGeometry().setFromPoints(pts) }
  }, [seed, params])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    blocks.forEach((b, i) => {
      o.position.set(b.x, b.h / 2, b.z)
      o.scale.set(b.w, b.h, b.d)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [blocks, params])
  useFade([mat, groundMat, roadMat], fade, [1, 1, 0.18])
  // instanced colours reach the shader through `instanceColor`; adapt the lit shader
  const instMat = useMemo(() => {
    const m = mat.clone()
    // colour by building height (instance scale y): darker low blocks, warm towers
    m.uniforms.uBase = { value: new THREE.Color(params.building ?? '#2b2742') }
    m.uniforms.uHi = { value: new THREE.Color(params.color ?? '#f0c27e') }
    m.vertexShader = litVert.replace('attribute vec3 color;', 'uniform vec3 uBase; uniform vec3 uHi;').replace('vC = color;', 'vC = mix(uBase, uHi, clamp(instanceMatrix[1][1] / 50.0, 0.0, 0.6));').replace('vec4 w = modelMatrix * vec4(position,1.);', 'vec4 w = modelMatrix * instanceMatrix * vec4(position,1.);').replace('mat3(modelMatrix) * normal', 'mat3(modelMatrix) * mat3(instanceMatrix) * normal')
    return m
  }, [mat, params])
  useFade([instMat], fade)
  return (
    <group>
      <mesh material={groundMat} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[90, 96]} />
      </mesh>
      <lineSegments geometry={roads} material={roadMat} />
      <instancedMesh ref={ref} args={[undefined, instMat, blocks.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      {ground && null}
    </group>
  )
}

// ---------------------------------------------------------------- plan

export function PlanPreset({ params, fade }: PresetProps) {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!params.image) return setTex(null)
    let alive = true
    new THREE.TextureLoader().load(vaultUrl(params.image), (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      if (alive) setTex(t)
    })
    return () => void (alive = false)
  }, [params.image])
  const { mat, grid, gridMat } = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({ color: tex ? 0xffffff : new THREE.Color('#141225'), map: tex, transparent: true, side: THREE.DoubleSide })
    const pts: THREE.Vector3[] = []
    for (let i = -100; i <= 100; i += 10) pts.push(new THREE.Vector3(i, 0.02, -100), new THREE.Vector3(i, 0.02, 100), new THREE.Vector3(-100, 0.02, i), new THREE.Vector3(100, 0.02, i))
    const gridMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#8e8cff'), transparent: true, opacity: 0.12 })
    ;(gridMat as any).__noDepth = true
    return { mat, grid: new THREE.BufferGeometry().setFromPoints(pts), gridMat }
  }, [tex])
  useFade([mat, gridMat], fade, [1, tex ? 0 : 0.12])
  const im = tex?.image as { width: number; height: number } | undefined
  const aspect = im ? im.height / im.width : 1
  const w = params.width ?? 200
  return (
    <group>
      <mesh material={mat} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[w, w * aspect]} />
      </mesh>
      {!tex && <lineSegments geometry={grid} material={gridMat} />}
    </group>
  )
}

// ---------------------------------------------------------------- model (.glb)

export function ModelPreset({ params, fade }: PresetProps) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!params.file) return setErr('no file')
    let alive = true
    new GLTFLoader().load(
      vaultUrl(params.file),
      (g) => {
        if (!alive) return
        const s = g.scene
        const box = new THREE.Box3().setFromObject(s)
        const size = box.getSize(new THREE.Vector3()).length() || 1
        const k = (105 / size) * (params.scale ?? 1)
        s.scale.setScalar(k)
        const c = box.getCenter(new THREE.Vector3())
        s.position.set(-c.x * k, -box.min.y * k, -c.z * k)
        s.traverse((o: any) => {
          if (o.material) {
            o.material = o.material.clone()
            o.material.transparent = true
          }
        })
        setScene(s)
      },
      undefined,
      (e) => alive && setErr(String(e))
    )
    return () => void (alive = false)
  }, [params.file, params.scale])
  useFrame(() => {
    scene?.traverse((o: any) => {
      if (o.material) {
        o.material.opacity = fade.current
        o.material.depthWrite = fade.current > 0.98
      }
    })
  })
  ;(window as any).__atlasModel = { loaded: !!scene, err }
  return (
    <group>
      <ambientLight intensity={0.35} />
      <directionalLight position={[60, 120, 40]} intensity={1.1} />
      {scene && <primitive object={scene} />}
    </group>
  )
}

// ---------------------------------------------------------------- layers

export function Layers({ layers, fade }: { layers: Record<string, any>[]; fade: FadeRef }) {
  const items = useMemo(
    () =>
      layers.map((l): { mats: THREE.Material[]; ops: number[]; node: React.ReactNode } => {
        const color = new THREE.Color(l.color ?? '#f0c27e')
        const op = l.opacity ?? 0.8
        const pts = ((l.points as number[][]) ?? []).map((p) => new THREE.Vector3(p[0], p[1], p[2]))
        switch (l.type) {
          case 'rings': {
            const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op })
            const geos = ((l.radii as number[]) ?? [l.radius ?? 50]).map((rad) => new THREE.BufferGeometry().setFromPoints(Array.from({ length: 193 }, (_, i) => new THREE.Vector3(Math.cos((i / 192) * Math.PI * 2) * rad, 0, Math.sin((i / 192) * Math.PI * 2) * rad))))
            return { mats: [mat], ops: [op], node: geos.map((g, i) => <lineLoop key={i} geometry={g} material={mat} />) }
          }
          case 'ribbons': {
            const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: op })
            const g = new THREE.BufferGeometry().setFromPoints(pts.length > 1 ? new THREE.CatmullRomCurve3(pts).getPoints(pts.length * 24) : pts)
            return { mats: [mat], ops: [op], node: <primitive object={new THREE.Line(g, mat)} /> }
          }
          case 'points':
          case 'sprites': {
            const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
            const s = l.size ?? (l.type === 'points' ? 3 : 8)
            return { mats: [mat], ops: [op], node: pts.map((p, i) => <sprite key={i} material={mat} position={p} scale={[s, s, 1]} />) }
          }
          case 'image': {
            const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
            if (l.image) new THREE.TextureLoader().load(vaultUrl(l.image), (t) => ((t.colorSpace = THREE.SRGBColorSpace), (mat.map = t), (mat.needsUpdate = true)))
            const s = l.size ?? 40
            return { mats: [mat], ops: [op], node: <mesh material={mat} position={l.position ?? [0, 0, 0]} rotation={l.rotation ?? [-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /></mesh> }
          }
          case 'text': {
            const c = document.createElement('canvas')
            c.width = 512
            c.height = 96
            const g = c.getContext('2d')!
            g.font = '500 54px "Fraunces Variable", Georgia, serif'
            g.fillStyle = '#' + color.getHexString()
            g.textAlign = 'center'
            g.textBaseline = 'middle'
            g.fillText(String(l.text ?? ''), 256, 50)
            const t = new THREE.CanvasTexture(c)
            t.colorSpace = THREE.SRGBColorSpace
            const mat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })
            const s = l.size ?? 30
            return { mats: [mat], ops: [op], node: <sprite material={mat} position={l.position ?? [0, 5, 0]} scale={[s, (s * 96) / 512, 1]} /> }
          }
          default:
            return { mats: [] as THREE.Material[], ops: [] as number[], node: null }
        }
      }),
    [layers]
  )
  useFade(items.flatMap((i) => i.mats) as any, fade, items.flatMap((i) => i.ops))
  return <group>{items.map((it, i) => <group key={i}>{it.node}</group>)}</group>
}
