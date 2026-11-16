// What can be changed about how a place looks, as data. The Inspector's scene controls, Atlas Live
// (describe_scene / preview_scene / apply_scene) and the assistant all read this one list, so a new control
// is one entry here plus the shader or preset reading `params.<key>`.
export interface DesignParam {
  key: string
  label: string
  kind: 'int' | 'num' | 'color' | 'text'
  group: string
  min?: number
  max?: number
  step?: number
  /** what the preset uses when the key is absent */
  default?: number | string
  help?: string
}
const n = (key: string, label: string, group: string, min: number, max: number, step: number, def: number, help?: string): DesignParam => ({ key, label, kind: 'num', group, min, max, step, default: def, help })
const i = (key: string, label: string, group: string, min: number, max: number, step: number, def: number): DesignParam => ({ key, label, kind: 'int', group, min, max, step, default: def })
const c = (key: string, label: string, group: string, def?: string): DesignParam => ({ key, label, kind: 'color', group, default: def })
const t = (key: string, label: string, group: string, help?: string): DesignParam => ({ key, label, kind: 'text', group, help })

export const DESIGN: Record<string, DesignParam[]> = {
  galaxy: [i('arms', 'Arms', 'Shape', 0, 8, 1, 2), n('twist', 'Twist', 'Shape', 0, 3, 0.05, 1), n('core', 'Core', 'Shape', 0, 1, 0.05, 0.5), n('bar', 'Bar', 'Shape', 0, 1, 0.05, 0), n('dust', 'Dust', 'Shape', 0, 1, 0.05, 0.5), i('stars', 'Stars', 'Shape', 5000, 200000, 5000, 60000)],
  system: [c('star_color', 'Star', 'Star')],
  planet: [
    n('sea', 'Sea level', 'Geography', -0.4, 0.4, 0.02, 0.02, 'higher floods more land'),
    n('continents', 'Land pieces', 'Geography', 0.6, 4, 0.1, 1.7, 'low = a few huge continents, high = many small islands'),
    n('rough', 'Coast detail', 'Geography', 0, 1, 0.05, 0.5, 'low = smooth coasts, high = jagged'),
    n('mountains', 'Mountains', 'Geography', 0, 1, 0.05, 0.5, 'how much high ground and snow-capped peaks'),
    n('ice', 'Ice caps', 'Geography', 0, 1, 0.05, 0.25, '0 = none, 1 = frozen world'),
    c('ocean', 'Ocean', 'Colours', '#2f5d8a'),
    c('land', 'Lowland', 'Colours', '#4f6b3a'),
    c('highland', 'Highland', 'Colours', '#6b5c47'),
    c('ice_color', 'Ice and snow', 'Colours', '#f0f5ff'),
    c('atmosphere', 'Air', 'Sky', '#7fb2ff'),
    n('air', 'Air thickness', 'Sky', 0, 2.5, 0.05, 1),
    n('clouds', 'Clouds', 'Sky', 0, 1, 0.05, 0.35),
    c('cloud_color', 'Cloud colour', 'Sky', '#ffffff'),
    n('lights', 'City lights', 'Life', 0, 1, 0.05, 0.3, 'lights on the night side of land'),
    c('lights_color', 'Light colour', 'Life', '#ffb359')
  ],
  terrain: [n('height', 'Relief', 'Shape', 2, 40, 1, 12), t('heightmap', 'Heightmap', 'Shape', 'vault path of an image')],
  city: [i('blocks', 'Blocks', 'Shape', 4, 30, 1, 12), c('color', 'Glow', 'Colours'), c('building', 'Stone', 'Colours')],
  plan: [t('image', 'Image', 'Plan', 'vault path of an image'), n('width', 'Width', 'Plan', 20, 200, 5, 100)],
  model: [t('file', '.glb file', 'Model', 'vault path, e.g. Atlas/Maps/model.glb'), n('scale', 'Scale', 'Model', 0.1, 5, 0.1, 1)]
}

/** Problems with `params` for a preset, in plain words; empty when fine. Unknown keys are refused. */
export function checkDesign(preset: string, params: Record<string, unknown>): string[] {
  const defs = DESIGN[preset]
  if (!defs) return [`Unknown preset "${preset}". Presets: ${Object.keys(DESIGN).join(', ')}.`]
  const out: string[] = []
  for (const [k, v] of Object.entries(params)) {
    const d = defs.find((x) => x.key === k)
    if (!d) {
      if (!(preset === 'system' && k === 'stars')) out.push(`"${k}" is not a ${preset} setting. Settings: ${defs.map((x) => x.key).join(', ')}.`)
    } else if (d.kind === 'color') {
      if (typeof v !== 'string' || !/^#([0-9a-fA-F]{6})$/.test(v)) out.push(`"${k}" must be a colour like #2f5d8a.`)
    } else if (d.kind === 'text') {
      if (typeof v !== 'string') out.push(`"${k}" must be text.`)
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v < d.min! || v > d.max!) out.push(`"${k}" must be a number from ${d.min} to ${d.max}.`)
    else if (d.kind === 'int' && !Number.isInteger(v)) out.push(`"${k}" must be a whole number.`)
  }
  return out
}
