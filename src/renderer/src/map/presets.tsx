// Scene presets for one map level. Units: the level's radius is 100. Each preset reads `fade` every frame.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rng, gauss, glowTexture, starRadius, starSizeOf, type FadeRef } from './util'
import { NOISE_GLSL } from './noise'

// Built scene resources are kept per (preset, seed, params) so re-entering a level never rebuilds it.
const cache = new Map<string, any>()
function cached<T>(key: string, build: () => T): T {
  if (!cache.has(key)) cache.set(key, build())
  return cache.get(key)
}

export interface PresetProps {
  seed: number
  params: Record<string, any>
  fade: FadeRef
  /** distances of child locations from the centre (for orbits) */
  orbits?: number[]
}

const pointVert = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixel;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = aSize * uPixel * (260.0 / max(1.0, -mv.z));
    gl_PointSize = clamp(s, 0.0, 9.0 * uPixel);
    vTw = 0.82 + 0.18 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0);
  }`
const pointFrag = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a = a * a;
    gl_FragColor = vec4(vColor * a * vTw * uOpacity, a * uOpacity);
  }`

function pointsMaterial(blending: THREE.Blending = THREE.AdditiveBlending) {
  return new THREE.ShaderMaterial({
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    uniforms: { uTime: { value: 0 }, uPixel: { value: Math.min(2, window.devicePixelRatio) }, uOpacity: { value: 1 } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending
  })
}

function buildGeometry(pos: number[], col: number[], size: number[]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
  const ph = new Float32Array(size.length)
  for (let i = 0; i < ph.length; i++) ph[i] = (i * 0.618034) % 1
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1))
  g.computeBoundingSphere()
  return g
}

// ---------------------------------------------------------------- galaxy

export function GalaxyPreset({ seed, params, fade }: PresetProps) {
  const { stars, dust, glow, mats, coreMats } = useMemo(() => cached(`galaxy:${seed}:${JSON.stringify(params)}`, () => {
    const r = rng(seed)
    const arms = params.arms ?? 4
    const twist = params.twist ?? 1.3
    const bar = params.bar ?? 0.2
    const core = params.core ?? 0.6
    const N = Math.min(params.stars ?? 60000, 250000)
    const palette: THREE.Color[] = (params.palette ?? ['#ffd9a0', '#f0c27e', '#9fb4ff', '#c8b6ff']).map((c: string) => new THREE.Color(c))
    const warm = palette[0]
    const coreWhite = new THREE.Color('#fff4e0')
    const pos: number[] = [], col: number[] = [], size: number[] = []
    const c = new THREE.Color()
    // logarithmic spiral: angle grows with ln(r)
    const armAngle = (dist: number, arm: number) => (arm / Math.max(1, arms)) * Math.PI * 2 + twist * Math.log(1 + dist / 12) * 1.6
    for (let i = 0; i < N; i++) {
      let x: number, y: number, z: number, dist: number
      const roll = r()
      if (roll < core * 0.22) {
        dist = Math.abs(gauss(r)) * 9
        const th = r() * Math.PI * 2
        x = Math.cos(th) * dist
        z = Math.sin(th) * dist
        y = gauss(r) * 3.2 * Math.exp(-dist / 12)
        c.copy(coreWhite).lerp(warm, r() * 0.6)
      } else if (roll < core * 0.22 + bar * 0.12) {
        const bl = (r() * 2 - 1) * (12 + bar * 30)
        dist = Math.abs(bl)
        x = bl + gauss(r) * 1.5
        z = gauss(r) * 2.6
        y = gauss(r) * 1.4
        c.copy(warm).lerp(coreWhite, r() * 0.5)
      } else if (arms === 0) {
        dist = Math.min(100, -Math.log(1 - r() * 0.985) * 26)
        const th = r() * Math.PI * 2
        x = Math.cos(th) * dist
        z = Math.sin(th) * dist
        y = gauss(r) * (3 * (1 - dist / 110) + 0.5)
        c.copy(warm).lerp(palette[2] ?? warm, Math.min(1, dist / 70))
      } else if (roll > 0.8) {
        // inter-arm field stars
        dist = Math.min(100, 8 + Math.pow(r(), 0.9) * 92)
        const th = r() * Math.PI * 2
        x = Math.cos(th) * dist
        z = Math.sin(th) * dist
        y = gauss(r) * (2.4 * (1 - dist / 115) + 0.4)
        c.copy(warm).lerp(palette[2] ?? warm, Math.min(1, dist / 80)).multiplyScalar(0.55)
      } else {
        dist = Math.min(100, 7 + Math.pow(r(), 1.25) * 93)
        const arm = Math.floor(r() * arms)
        const spread = gauss(r) * (0.07 + 0.09 * (dist / 100)) // radians
        const a = armAngle(dist, arm) + spread
        const jitter = 0.8 + dist * 0.015
        x = Math.cos(a) * dist + gauss(r) * jitter
        z = Math.sin(a) * dist + gauss(r) * jitter
        y = gauss(r) * (2.2 * (1 - dist / 115) + 0.35)
        const t = Math.min(1, dist / 70)
        const outer = palette[2 + Math.floor(r() * Math.max(1, palette.length - 2))] ?? palette[palette.length - 1]
        c.copy(warm).lerp(outer, t * (0.6 + 0.4 * r()))
      }
      const bright = 0.35 + Math.pow(r(), 3) * 1.25
      pos.push(x, y, z)
      col.push(c.r * bright, c.g * bright, c.b * bright)
      size.push(0.55 + Math.pow(r(), 9) * 3.2)
    }
    // dust lanes and pink star-forming knots along the inside edge of the arms
    const dpos: number[] = [], dcol: number[] = [], dsize: number[] = []
    const kpos: number[] = [], kcol: number[] = [], ksize: number[] = []
    const dustAmt = params.dust ?? 0.4
    const dustN = Math.floor(N * 0.06 * dustAmt)
    const dc = new THREE.Color('#1a0f12')
    for (let i = 0; i < dustN && arms > 0; i++) {
      const dist = 10 + r() * 80
      const arm = Math.floor(r() * arms)
      const a = armAngle(dist, arm) - 0.14 + gauss(r) * 0.06
      dpos.push(Math.cos(a) * dist + gauss(r) * 1.2, gauss(r) * 0.6, Math.sin(a) * dist + gauss(r) * 1.2)
      const k = 0.5 + r() * 0.5
      dcol.push(dc.r * k, dc.g * k, dc.b * k)
      dsize.push(5 + r() * 7)
    }
    const knotN = arms > 0 ? Math.floor(260 * dustAmt + 60) : 0
    const kc = new THREE.Color('#ff7fa6')
    const kc2 = new THREE.Color('#9fc4ff')
    for (let i = 0; i < knotN; i++) {
      const dist = 18 + r() * 75
      const arm = Math.floor(r() * arms)
      const a = armAngle(dist, arm) + gauss(r) * 0.07
      kpos.push(Math.cos(a) * dist, gauss(r) * 0.5, Math.sin(a) * dist)
      const cc = r() < 0.7 ? kc : kc2
      const k = 0.18 + r() * 0.25
      kcol.push(cc.r * k, cc.g * k, cc.b * k)
      ksize.push(2.5 + r() * 4)
    }
    // unresolved starlight: many large, very faint points that make the arms read as continuous light
    for (let i = 0; i < 9000 && arms > 0; i++) {
      const dist = Math.min(100, 5 + Math.pow(r(), 1.1) * 95)
      const arm = Math.floor(r() * arms)
      const a = armAngle(dist, arm) + gauss(r) * (0.09 + 0.08 * (dist / 100))
      kpos.push(Math.cos(a) * dist + gauss(r) * 1.5, gauss(r) * 1.2, Math.sin(a) * dist + gauss(r) * 1.5)
      const cc = c.copy(warm).lerp(palette[2] ?? warm, Math.min(1, dist / 60))
      const k = 0.05 * (1.2 - dist / 120)
      kcol.push(cc.r * k, cc.g * k, cc.b * k)
      ksize.push(7 + r() * 6)
    }
    const starMat = pointsMaterial()
    const knotMat = pointsMaterial()
    const dustMat = pointsMaterial(THREE.NormalBlending)
    // dust darkens: plain alpha blend of a near-black colour
    dustMat.fragmentShader = /* glsl */ `
      uniform float uOpacity; varying vec3 vColor; varying float vTw;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * 0.32;
        gl_FragColor = vec4(vColor, a * uOpacity); }`
    const coreA = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffcf8a').multiplyScalar(0.55 * core + 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const coreB = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#fff1d6').multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const haze = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#6b5cff').multiplyScalar(0.07), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    return {
      stars: buildGeometry(pos, col, size),
      dust: buildGeometry(dpos, dcol, dsize),
      glow: buildGeometry(kpos, kcol, ksize),
      mats: [starMat, knotMat, dustMat],
      coreMats: [coreA, coreB, haze]
    }
  }), [seed, params])

  useFrame(({ clock }) => {
    const f = fade.current
    for (const m of mats) {
      m.uniforms.uOpacity.value = f
      m.uniforms.uTime.value = clock.elapsedTime
    }
    const base = [1, 1, 1]
    coreMats.forEach((m, i) => (m.opacity = f * base[i]))
  })

  return (
    <group>
      <sprite material={coreMats[2]} scale={[260, 260, 1]} />
      <points geometry={stars} material={mats[0]} />
      <points geometry={glow} material={mats[1]} />
      <points geometry={dust} material={mats[2]} renderOrder={2} />
      <sprite material={coreMats[0]} scale={[70, 70, 1]} renderOrder={3} />
      <sprite material={coreMats[1]} scale={[16, 16, 1]} renderOrder={3} />
    </group>
  )
}

// ---------------------------------------------------------------- system

export function SystemPreset({ seed, params, fade, orbits = [] }: PresetProps) {
  const { starMat, glowMats, ringMat, rings, disc } = useMemo(() => cached(`system:${seed}:${JSON.stringify(params)}:${orbits.join(',')}`, () => {
    const color = new THREE.Color(params.star_color ?? '#ffd59a')
    const starMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false, transparent: true })
    const glowMats = [
      new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    ]
    const ringMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#b9b2ff'), transparent: true, opacity: 0.16, depthWrite: false })
    const radii = [...new Set([...(params.orbits ?? []), ...orbits].map((r: number) => Math.round(r * 10) / 10))]
    const rings = radii.map((rad) => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad))
      }
      return new THREE.BufferGeometry().setFromPoints(pts)
    })
    // faint zodiacal dust
    const r = rng(seed)
    const pos: number[] = [], col: number[] = [], size: number[] = []
    for (let i = 0; i < 2500; i++) {
      const d = 10 + Math.pow(r(), 0.7) * 90
      const a = r() * Math.PI * 2
      pos.push(Math.cos(a) * d, gauss(r) * 0.8, Math.sin(a) * d)
      const k = 0.08 + r() * 0.12
      col.push(color.r * k, color.g * k * 0.9, color.b * k * 0.9 + 0.02)
      size.push(0.8 + r() * 1.2)
    }
    return { starMat, glowMats, ringMat, rings, disc: { geo: buildGeometry(pos, col, size), mat: pointsMaterial() } }
  }), [seed, params, orbits])

  const Rs = starRadius(starSizeOf(params))
  useFrame(({ clock }) => {
    const f = fade.current
    starMat.opacity = f
    glowMats[0].opacity = f
    glowMats[1].opacity = f
    ringMat.opacity = 0.16 * f
    disc.mat.uniforms.uOpacity.value = f
    disc.mat.uniforms.uTime.value = clock.elapsedTime
  })

  return (
    <group>
      {Array.isArray(params.stars) && params.stars.length >= 1 ? (
        <MultiStar stars={params.stars} fade={fade} unit={Rs / starSizeOf(params)} />
      ) : (
        <>
          <mesh material={starMat}>
            <sphereGeometry args={[Rs, 48, 32]} />
          </mesh>
          <sprite material={glowMats[0]} scale={[Rs * 9.2, Rs * 9.2, 1]} />
        </>
      )}
      <sprite material={glowMats[1]} scale={[180, 180, 1]} />
      {rings.map((g, i) => (
        <lineLoop key={i} geometry={g} material={ringMat} />
      ))}
      <points geometry={disc.geo} material={disc.mat} />
    </group>
  )
}

/** Two or more stars arranged round a common centre with a slow visual orbit (no physics). */
function MultiStar({ stars, fade, unit }: { stars: { color?: string; size?: number; name?: string }[]; fade: FadeRef; unit: number }) {
  const group = useRef<THREE.Group>(null)
  const items = useMemo(
    () =>
      stars.map((s) => {
        const c = new THREE.Color(s.color ?? '#ffd59a')
        return {
          size: Math.max(1, s.size ?? 5) * unit,
          body: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3), toneMapped: false, transparent: true }),
          glow: new THREE.SpriteMaterial({ map: glowTexture(), color: c.clone().multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
        }
      }),
    [JSON.stringify(stars), unit]
  )
  const total = items.reduce((s, i) => s + i.size, 0)
  const radius = items.length > 1 ? Math.max(8, total * 1.4) : 0
  useFrame((_s, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.08
    items.forEach((i) => ((i.body.opacity = fade.current), (i.glow.opacity = fade.current)))
  })
  return (
    <group ref={group}>
      {items.map((it, i) => {
        // heavier stars sit nearer the centre
        const a = (i / items.length) * Math.PI * 2
        const r = items.length > 1 ? radius * (1 - it.size / total) : 0
        return (
          <group key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]}>
            <mesh material={it.body}>
              <sphereGeometry args={[it.size, 40, 28]} />
            </mesh>
            <sprite material={it.glow} scale={[it.size * 9, it.size * 9, 1]} />
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- planet

const planetVert = /* glsl */ `
  varying vec3 vPos; varying vec3 vNormalW; varying vec3 vViewDir;
  void main(){
    vPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

const planetFrag = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uOcean; uniform vec3 uLand; uniform vec3 uHigh; uniform vec3 uIce; uniform vec3 uLights; uniform vec3 uSeed; uniform float uOpacity; uniform vec3 uLight; uniform float uSea;
  uniform float uFreq; uniform float uRough; uniform float uMount; uniform float uIceCap; uniform float uLightAmt;
  varying vec3 vPos; varying vec3 vNormalW; varying vec3 vViewDir;
  // uRough sets how fast finer detail fades: 0.5 is the classic look
  float fbm(vec3 p){ float a=0.5, s=0.0, g=0.3+uRough*0.4; for(int i=0;i<6;i++){ s+=a*snoise(p); p*=2.03; a*=g; } return s; }
  void main(){
    vec3 p = normalize(vPos);
    float h = fbm(p * uFreq + uSeed);
    float lat = abs(p.y);
    vec3 deep = uOcean * 0.45, shallow = uOcean * 1.15;
    vec3 col;
    if (h < uSea) col = mix(deep, shallow, smoothstep(uSea - 0.35, uSea, h));
    else {
      // uMount 0.5 is the classic look; higher pulls highland and snow lines down
      float span = mix(0.9, 0.2, uMount);
      float t = smoothstep(uSea, uSea + span, h);
      col = mix(uLand, uHigh, t);
      float snow = mix(0.75, 0.2, uMount);
      col = mix(col, uIce * 0.97, smoothstep(snow, snow + 0.2, h) * step(0.001, uMount));
    }
    float cap = 1.0 - uIceCap * 0.88;
    col = mix(col, uIce, smoothstep(cap, cap + 0.12, lat + h * 0.08) * step(0.001, uIceCap));
    float diff = max(0.0, dot(vNormalW, uLight));
    float term = smoothstep(-0.08, 0.35, dot(vNormalW, uLight));
    float spec = h < uSea ? pow(max(0.0, dot(reflect(-uLight, vNormalW), vViewDir)), 40.0) * 0.5 : 0.0;
    vec3 lit = col * (0.04 + 0.96 * diff * term) + vec3(1.0, 0.92, 0.8) * spec * term;
    // night-side city lights for land: more lights and brighter as uLightAmt rises
    lit += (h > uSea ? 1.0 : 0.0) * (1.0 - term) * uLights * (0.02 + uLightAmt * 0.1) * step(0.9 - uLightAmt * 0.4, snoise(p * 40.0 + uSeed)) * step(0.001, uLightAmt);
    gl_FragColor = vec4(lit, uOpacity);
  }`

const atmoFrag = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity; uniform vec3 uLight; uniform float uThick;
  varying vec3 vPos; varying vec3 vNormalW; varying vec3 vViewDir;
  void main(){
    // back faces of the shell: d = 0 at the outer edge, about -0.4 at the planet's limb
    float d = dot(vNormalW, vViewDir);
    float a = pow(clamp(-d * 2.6, 0.0, 1.0), 2.2);
    float lit = smoothstep(-0.35, 0.5, dot(vNormalW, uLight));
    gl_FragColor = vec4(uColor * a * (0.04 + 1.5 * lit) * uOpacity * uThick, 1.0);
  }`

const cloudFrag = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uOpacity; uniform vec3 uLight; uniform vec3 uSeed; uniform float uAmount; uniform float uTime; uniform vec3 uCloud;
  varying vec3 vPos; varying vec3 vNormalW; varying vec3 vViewDir;
  void main(){
    vec3 p = normalize(vPos);
    float n = snoise(p * 3.0 + uSeed + vec3(uTime*0.01,0.,0.)) * 0.6 + snoise(p * 7.0 - uSeed) * 0.3;
    float a = smoothstep(0.55 - uAmount * 0.6, 0.9, n + 0.3) * 0.72;
    float lit = smoothstep(-0.1, 0.5, dot(vNormalW, uLight));
    gl_FragColor = vec4(uCloud * lit, a * uOpacity * (0.15 + 0.85 * lit) * step(0.001, uAmount));
  }`

export const PLANET_RADIUS = 40

export function PlanetPreset({ seed, params, fade }: PresetProps) {
  const cloudRef = useRef<THREE.Mesh>(null)
  const { surf, atmo, clouds } = useMemo(() => cached(`planet:${seed}:${JSON.stringify(params)}`, () => {
    const r = rng(seed)
    const light = new THREE.Vector3(...((params.__light as number[]) ?? [1, 0.35, 0.6])).normalize()
    const sd = new THREE.Vector3(r() * 100, r() * 100, r() * 100)
    const ocean = new THREE.Color(params.ocean ?? params.color ?? '#2f5d8a')
    const land = new THREE.Color(params.land ?? '#4f6b3a')
    const surf = new THREE.ShaderMaterial({
      vertexShader: planetVert,
      fragmentShader: planetFrag,
      uniforms: { uOcean: { value: ocean }, uLand: { value: land }, uSeed: { value: sd }, uOpacity: { value: 1 }, uLight: { value: light }, uSea: { value: params.sea ?? 0.02 }, uHigh: { value: new THREE.Color(params.highland ?? '#6b5c47') }, uIce: { value: new THREE.Color(params.ice_color ?? '#f0f5ff') }, uLights: { value: new THREE.Color(params.lights_color ?? '#ffb359') }, uFreq: { value: params.continents ?? 1.7 }, uRough: { value: params.rough ?? 0.5 }, uMount: { value: params.mountains ?? 0.5 }, uIceCap: { value: params.ice ?? 0.25 }, uLightAmt: { value: params.lights ?? 0.3 } },
      transparent: true
    })
    const atmo = new THREE.ShaderMaterial({
      vertexShader: planetVert,
      fragmentShader: atmoFrag,
      uniforms: { uColor: { value: new THREE.Color(params.atmosphere ?? '#7fb2ff') }, uOpacity: { value: 1 }, uLight: { value: light }, uThick: { value: params.air ?? 1 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide
    })
    const clouds = new THREE.ShaderMaterial({
      vertexShader: planetVert,
      fragmentShader: cloudFrag,
      uniforms: { uOpacity: { value: 1 }, uLight: { value: light }, uSeed: { value: sd.clone().multiplyScalar(0.7) }, uAmount: { value: params.clouds ?? 0.35 }, uTime: { value: 0 }, uCloud: { value: new THREE.Color(params.cloud_color ?? '#ffffff') } },
      transparent: true,
      depthWrite: false
    })
    return { surf, atmo, clouds }
  }), [seed, params])

  useFrame(({ clock }, dt) => {
    const f = fade.current
    surf.uniforms.uOpacity.value = f
    surf.depthWrite = f > 0.98
    atmo.uniforms.uOpacity.value = f
    clouds.uniforms.uOpacity.value = f
    clouds.uniforms.uTime.value = clock.elapsedTime
    if (cloudRef.current) cloudRef.current.rotation.y += dt * 0.004
  })

  return (
    <group>
      <mesh material={surf}>
        <sphereGeometry args={[PLANET_RADIUS, 128, 96]} />
      </mesh>
      <mesh ref={cloudRef} material={clouds}>
        <sphereGeometry args={[PLANET_RADIUS * 1.012, 96, 64]} />
      </mesh>
      <mesh material={atmo} scale={1.07}>
        <sphereGeometry args={[PLANET_RADIUS, 64, 48]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- generic (until S6 presets)

export function GenericPreset({ fade, params }: PresetProps) {
  const { mats, geos } = useMemo(() => {
    const color = new THREE.Color(params.color ?? '#9a92ff')
    const mk = (o: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false })
    const circle = (rad: number) => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 192; i++) {
        const a = (i / 192) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad))
      }
      return new THREE.BufferGeometry().setFromPoints(pts)
    }
    const spokes: THREE.Vector3[] = []
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      spokes.push(new THREE.Vector3(Math.cos(a) * 20, 0, Math.sin(a) * 20), new THREE.Vector3(Math.cos(a) * 100, 0, Math.sin(a) * 100))
    }
    return { mats: [mk(0.22), mk(0.07)], geos: { rings: [100, 75, 50, 25].map(circle), spokes: new THREE.BufferGeometry().setFromPoints(spokes) } }
  }, [params])
  useFrame(() => {
    mats[0].opacity = 0.22 * fade.current
    mats[1].opacity = 0.07 * fade.current
  })
  return (
    <group>
      {geos.rings.map((g, i) => (
        <lineLoop key={i} geometry={g} material={i === 0 ? mats[0] : mats[1]} />
      ))}
      <lineSegments geometry={geos.spokes} material={mats[1]} />
    </group>
  )
}

// ---------------------------------------------------------------- backdrop

export function Backdrop() {
  const { geo, mat } = useMemo(() => {
    const r = rng(99)
    const pos: number[] = [], col: number[] = [], size: number[] = []
    const c = new THREE.Color()
    for (let i = 0; i < 5000; i++) {
      const v = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize().multiplyScalar(1400 + r() * 400)
      pos.push(v.x, v.y, v.z)
      c.setHSL(0.6 + r() * 0.15, 0.4, 0.5 + r() * 0.4)
      const k = 0.15 + Math.pow(r(), 4) * 0.8
      col.push(c.r * k, c.g * k, c.b * k)
      size.push((1.2 + Math.pow(r(), 8) * 2.5) * 5)
    }
    const mat = pointsMaterial()
    mat.uniforms.uOpacity.value = 1
    return { geo: buildGeometry(pos, col, size), mat }
  }, [])
  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime))
  return <points geometry={geo} material={mat} />
}
