// Headings and heading sections of a markdown body.
import { maskCode, normHeading } from './links'

export interface Heading {
  level: number
  text: string
  line: number // 0-based line within the text given
  offset: number
}

export function extractHeadings(text: string): Heading[] {
  const masked = maskCode(text)
  const out: Heading[] = []
  const re = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    out.push({ level: m[1].length, text: text.slice(m.index + m[1].length, m.index + m[0].length).replace(/[ \t#]*$/, '').trim(), line: masked.slice(0, m.index).split('\n').length - 1, offset: m.index })
  }
  return out
}

/** The text of a heading's section (heading line included) up to the next heading of the same or higher level. */
export function sectionText(text: string, heading: string): string | null {
  const hs = extractHeadings(text)
  const i = hs.findIndex((h) => normHeading(h.text) === normHeading(heading))
  if (i < 0) return null
  const h = hs[i]
  const next = hs.slice(i + 1).find((x) => x.level <= h.level)
  return text.slice(h.offset, next ? next.offset : text.length).replace(/\s+$/, '') + '\n'
}
