import * as THREE from 'three'
import type { MapKind } from '@core/vault'

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const gauss = (r: () => number) => {
  const u = Math.max(1e-9, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}
export const hashString = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

let glowTex: THREE.Texture | null = null
/** Soft radial glow sprite texture (shared). */
export function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.12, 'rgba(255,255,255,0.55)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.12)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  glowTex.colorSpace = THREE.SRGBColorSpace
  return glowTex
}

export const DEFAULT_SIZE: Partial<Record<MapKind, number>> = { universe: 100, galaxy: 30, nebula: 18, black_hole: 6, region: 12, system: 7, star: 7, planet: 5, gas_giant: 8, moon: 2.5, dwarf_planet: 2, asteroid: 1, asteroid_belt: 3, comet: 2, ring: 4, station: 1.5, continent: 10, city: 6, district: 5, building: 4, room: 3, other: 5 }

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

/** Shared mutable fade value a level reads every frame (0 hidden .. 1 fully shown). */
export interface FadeRef { current: number }

// ---- relative scale inside a star system ----
// A system's map_size is its star's size. Bodies are drawn relative to that star: a size-6 planet is a speck
// beside a size-60 star and looms over a size-2 one. A size-7 star (the default) looks as it always did.
const STAR_REF = 7
/** The star size a system scene is scaled against: its largest listed star, else the system's own size. */
export const starSizeOf = (params: Record<string, any>): number =>
  Array.isArray(params.stars) && params.stars.length ? Math.max(...params.stars.map((s: any) => Math.max(1, Number(s?.size) || 5))) : Math.max(0.5, Number(params.__star) || STAR_REF)
/** Drawn radius of a star of that size (compressed so huge stars still fit the level). */
export const starRadius = (S: number) => 5 * Math.min(2.8, Math.max(0.45, Math.sqrt(S / STAR_REF)))
/** Factor applied to a body's size inside a system with a star of size S. */
export const bodyScale = (S: number) => (starRadius(S) / 5) * (STAR_REF / S)
/** Drawn size of a body: scaled against the star, kept between a visible speck and a giant that still fits. */
export const drawnSize = (size: number, rel: number | null) => (rel === null ? size : Math.min(75, Math.max(0.9, size * rel)))
