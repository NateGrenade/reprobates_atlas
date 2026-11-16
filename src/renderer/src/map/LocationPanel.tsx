// Inspector sections for a location: placement (kind, size, parent, position) and the scene inspector
// (preset parameters with live preview, saved to Atlas/Maps/<slug>.scene.json).
import { useMemo } from 'react'
import { MAP_KINDS, MAP_KIND_LABEL, type Location } from '@core/vault'
import { patchFrontmatter, patchFrontmatterMany } from '@core/note'
import { validateSceneText, type SceneSpec } from '@core/scene'
import { PATHS } from '@core/config'
import { DESIGN } from '@core/design'
import { saveScene } from './sceneOps'
import { useStore } from '../store'
import { KIND_PRESET } from './Level'

const PRESETS = ['galaxy', 'system', 'planet', 'terrain', 'city', 'plan', 'model'] as const
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene'

export function LocationPanel({ loc }: { loc: Location }) {
  const ix = useStore((s) => s.index)!
  const files = useStore((s) => s.files)
  const preview = useStore((s) => s.scenePreview[loc.id]) as SceneSpec | undefined
  const setPreview = useStore((s) => s.setScenePreview)
  const st = useStore.getState
  const write = (patch: Record<string, unknown>) => {
    const cur = st().files.get(loc.id)
    if (typeof cur !== 'string') return
    const next = patchFrontmatterMany(cur, patch)
    if (next !== cur) st().writeFile(loc.id, next)
  }
  const saved = useMemo<SceneSpec | null>(() => {
    if (!loc.scene) return null
    const t = files.get(loc.scene)
    return typeof t === 'string' ? validateSceneText(t).spec ?? null : null
  }, [files, loc.scene])
  const sceneError = useMemo(() => {
    if (!loc.scene) return null
    const t = files.get(loc.scene)
    if (typeof t !== 'string') return 'scene file not found'
    const v = validateSceneText(t)
    return v.issues.length ? `line ${v.issues[0].line}: ${v.issues[0].message}` : null
  }, [files, loc.scene])
  const spec: SceneSpec = preview ?? saved ?? { version: 1, preset: (KIND_PRESET[loc.kind] as SceneSpec['preset']) ?? 'planet', params: {} }
  const setSpec = (s: SceneSpec) => setPreview(loc.id, s)
  const parents = ix.locations().filter((l) => l.id !== loc.id && !ix.subtree(loc.id).has(l.id))

  const save = async () => void (await saveScene(loc, spec))

  return (
    <>
      <div className="insp-section">
        <h4>Map placement</h4>
        <div className="info" style={{ gridTemplateColumns: '1fr' }}>
          <div className="info-row">
            <span className="info-k">Kind</span>
            <select className="field-select" value={loc.kind} onChange={(e) => write({ map_kind: e.target.value })}>
              {MAP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MAP_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="info-row">
            <span className="info-k">Inside</span>
            <select className="field-select" value={loc.parent ?? ''} onChange={(e) => write({ parent: e.target.value ? `[[${ix.entities.get(e.target.value)!.name}]]` : undefined })}>
              <option value="">Top level</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.kind}
                </option>
              ))}
            </select>
          </div>
          <div className="info-row">
            <span className="info-k">Size</span>
            <input className="info-v" type="number" step={0.5} min={0.5} key={'s' + loc.size} defaultValue={loc.size ?? ''} placeholder="default" onBlur={(e) => write({ map_size: e.currentTarget.value ? Number(e.currentTarget.value) : undefined })} />
          </div>
          <div className="info-row">
            <span className="info-k">Position</span>
            <span className="xyz">
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <label key={axis}>
                  {axis}
                  <input
                    className="info-v"
                    type="number"
                    step={1}
                    key={axis + loc.pos[i]}
                    defaultValue={loc.pos[i]}
                    aria-label={`Position ${axis}`}
                    onBlur={(e) => {
                      const v = Number(e.currentTarget.value)
                      if (!Number.isFinite(v) || v === loc.pos[i]) return
                      const p = [...loc.pos]
                      p[i] = Math.round(v * 10) / 10
                      write({ map_pos: p })
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                </label>
              ))}
            </span>
          </div>
          <div className="info-row">
            <span className="info-k">Orbit tilt</span>
            <input className="info-v" type="number" step={1} key={'i' + loc.inclination} defaultValue={loc.inclination ?? 0} aria-label="Orbit tilt" onBlur={(e) => { const v = Number(e.currentTarget.value); write({ map_inclination: v ? v : undefined }) }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          </div>
        </div>
      </div>
      <div className="insp-section">
        <h4>
          Scene {preview && <span style={{ color: 'var(--accent)', letterSpacing: 0 }}>· unsaved preview</span>}
        </h4>
        {sceneError && <p className="scene-err">Saved scene is invalid ({sceneError}); the map shows the default look.</p>}
        <div className="info" style={{ gridTemplateColumns: '1fr' }}>
          <div className="info-row">
            <span className="info-k">Preset</span>
            <select className="field-select" value={spec.preset} onChange={(e) => setSpec({ ...spec, preset: e.target.value as SceneSpec['preset'], params: {} })}>
              {PRESETS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="info-row">
            <span className="info-k">{spec.preset === 'planet' ? 'Layout' : 'Seed'}</span>
            <span className="slider">
              <button className="chip-btn reroll" title="A different random layout of land, clouds and lights" onClick={() => setSpec({ ...spec, seed: Math.floor(Math.random() * 1e9) })}>
                Reroll
              </button>
              <input className="info-v" type="number" value={spec.seed ?? ''} placeholder="from name" onChange={(e) => setSpec({ ...spec, seed: e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)) })} />
            </span>
          </div>
          {(DESIGN[spec.preset] ?? []).map(({ key, label, kind, min, max, step, group, default: def, help }, idx, all) => {
            const v = spec.params?.[key]
            const head = all.length > 6 && group !== all[idx - 1]?.group
            const set = (val: unknown) => setSpec({ ...spec, params: { ...(spec.params ?? {}), [key]: val } })
            return (
              <div className={`info-row${head ? ' group-start' : ''}`} key={key} data-group={head ? group : undefined} title={help}>
                <span className="info-k">{label}</span>
                {kind === 'color' ? (
                  <input className="color-in" type="color" value={typeof v === 'string' ? v : typeof def === 'string' ? def : '#888888'} onChange={(e) => set(e.target.value)} />
                ) : kind === 'text' ? (
                  <input className="info-v" value={v ?? ''} placeholder={key === 'file' ? 'Atlas/Maps/model.glb' : 'Atlas/Maps/…'} onChange={(e) => set(e.target.value || undefined)} />
                ) : (
                  <span className="slider">
                    <input type="range" min={min} max={max} step={step} value={typeof v === 'number' ? v : typeof def === 'number' ? def : ((min ?? 0) + (max ?? 1)) / 2} onChange={(e) => set(kind === 'int' ? Math.round(Number(e.target.value)) : Number(e.target.value))} />
                    <span className="muted">{typeof v === 'number' ? v : 'auto'}</span>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {spec.preset === 'system' && (
          <div className="stars-edit">
            <div className="info-k" style={{ margin: '10px 0 6px' }}>Stars</div>
            {((spec.params?.stars as { color?: string; size?: number; name?: string }[]) ?? []).map((s, i, arr) => {
              const setStar = (patch: object) => setSpec({ ...spec, params: { ...(spec.params ?? {}), stars: arr.map((x, j) => (j === i ? { ...x, ...patch } : x)) } })
              return (
                <div className="star-row" key={i}>
                  <input className="color-in" type="color" value={s.color ?? '#ffd59a'} onChange={(e) => setStar({ color: e.target.value })} aria-label={`Star ${i + 1} colour`} />
                  <input className="info-v" placeholder={`Star ${i + 1} name`} value={s.name ?? ''} onChange={(e) => setStar({ name: e.target.value || undefined })} />
                  <input className="info-v" type="number" min={1} step={0.5} value={s.size ?? 5} onChange={(e) => setStar({ size: Math.max(1, Number(e.target.value) || 5) })} aria-label={`Star ${i + 1} size`} />
                  <button className="link-btn danger" onClick={() => setSpec({ ...spec, params: { ...(spec.params ?? {}), stars: arr.filter((_, j) => j !== i) } })}>
                    ×
                  </button>
                </div>
              )
            })}
            <button
              className="chip-btn add-star"
              onClick={() => {
                const cur = (spec.params?.stars as object[]) ?? []
                const seed = cur.length ? cur : [{ color: spec.params?.star_color ?? '#ffd59a', size: 5 }]
                setSpec({ ...spec, params: { ...(spec.params ?? {}), stars: [...seed, { color: seed.length % 2 ? '#a9c1ff' : '#ffb27a', size: 3 }] } })
              }}
            >
              + Add star
            </button>
          </div>
        )}
        <div className="insp-actions" style={{ marginTop: 12 }}>
          <button className="chip-btn primary" onClick={save} disabled={!preview}>
            Save scene
          </button>
          {preview && (
            <button className="chip-btn" onClick={() => setPreview(loc.id, null)}>
              Revert
            </button>
          )}
          <span className="muted" style={{ fontSize: 'calc(11px * var(--ui-scale))', alignSelf: 'center' }}>
            {loc.scene ?? `${PATHS.maps}/${slug(loc.name)}.scene.json`}
          </span>
        </div>
      </div>
    </>
  )
}
