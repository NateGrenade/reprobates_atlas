// Scene spec validation with file line numbers.
import Ajv from 'ajv'
import { parseTree, findNodeAtLocation, type ParseError, printParseErrorCode } from 'jsonc-parser'
import schema from './scene.schema.json'

export const sceneSchema = schema

const ajv = new Ajv({ allErrors: true, strict: false })
const validateFn = ajv.compile(schema)

export interface SceneIssue { line: number; message: string }

export interface SceneSpec {
  version: 1
  preset: 'galaxy' | 'system' | 'planet' | 'terrain' | 'city' | 'plan' | 'model'
  seed?: number
  params?: Record<string, any>
  layers?: Record<string, any>[]
  labels?: { text: string; position: [number, number, number]; importance?: number }[]
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length

export function validateSceneText(text: string): { spec?: SceneSpec; issues: SceneIssue[] } {
  const errs: ParseError[] = []
  const tree = parseTree(text, errs, { allowTrailingComma: false, disallowComments: true })
  if (errs.length || !tree) {
    return { issues: errs.map((e) => ({ line: lineOf(text, e.offset), message: `JSON syntax: ${printParseErrorCode(e.error)}` })) }
  }
  const data = JSON.parse(text)
  if (validateFn(data)) return { spec: data as unknown as SceneSpec, issues: [] }
  const issues = (validateFn.errors ?? []).map((e) => {
    const segs = e.instancePath.split('/').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s.replace(/~1/g, '/').replace(/~0/g, '~')))
    const node = findNodeAtLocation(tree, segs)
    const where = e.instancePath || '(root)'
    const extra = e.params && 'allowedValues' in e.params ? ` (${(e.params as any).allowedValues.join(', ')})` : e.params && 'additionalProperty' in e.params ? ` '${(e.params as any).additionalProperty}'` : ''
    return { line: node ? lineOf(text, node.offset) : 1, message: `${where} ${e.message}${extra}` }
  })
  return { issues }
}
