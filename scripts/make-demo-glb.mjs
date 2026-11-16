// Writes a tiny demo .glb (a keep: a few boxes) to the given path. Demo asset, not canon.
import { writeFileSync } from 'node:fs'
const boxes = [ [0, 6, 0, 30, 12, 30], [0, 20, 0, 14, 16, 14], [-18, 9, -18, 7, 18, 7], [18, 9, -18, 7, 18, 7], [-18, 9, 18, 7, 18, 7], [18, 9, 18, 7, 18, 7] ]
const pos = [], nor = [], idx = []
const faces = [ [[1,0,0],[0,1,0],[0,0,1]], [[-1,0,0],[0,1,0],[0,0,-1]], [[0,1,0],[0,0,1],[1,0,0]], [[0,-1,0],[0,0,-1],[1,0,0]], [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[-1,0,0],[0,1,0]] ]
for (const [cx, cy, cz, sx, sy, sz] of boxes) {
  for (const [n, u, v] of faces) {
    const base = pos.length / 3
    for (const [a, b] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      const p = [0,1,2].map((i) => n[i] * 0.5 + u[i] * a * 0.5 + v[i] * b * 0.5)
      pos.push(cx + p[0] * sx, cy + p[1] * sy, cz + p[2] * sz); nor.push(...n)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}
const P = new Float32Array(pos), N = new Float32Array(nor), I = new Uint16Array(idx)
const pad = (n) => (n + 3) & ~3
const bin = Buffer.alloc(pad(P.byteLength) + pad(N.byteLength) + pad(I.byteLength))
Buffer.from(P.buffer).copy(bin, 0); Buffer.from(N.buffer).copy(bin, pad(P.byteLength)); Buffer.from(I.buffer).copy(bin, pad(P.byteLength) + pad(N.byteLength))
const min = [0,1,2].map((i) => Math.min(...pos.filter((_, j) => j % 3 === i))), max = [0,1,2].map((i) => Math.max(...pos.filter((_, j) => j % 3 === i)))
const gltf = {
  asset: { version: '2.0', generator: 'reprobates-atlas demo' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Demo keep' }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.62, 0.55, 0.48, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [ { buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: pad(P.byteLength), byteLength: N.byteLength, target: 34962 }, { buffer: 0, byteOffset: pad(P.byteLength) + pad(N.byteLength), byteLength: I.byteLength, target: 34963 } ],
  accessors: [ { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5123, count: I.length, type: 'SCALAR' } ]
}
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc(pad(json.length) - json.length, 0x20)])
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b }
writeFileSync(process.argv[2], Buffer.concat([header, ch(json.length, 0x4e4f534a), json, ch(bin.length, 0x004e4942), bin]))
console.log('wrote', process.argv[2])
