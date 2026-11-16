export interface WriterDocument { path: string; content: string }
export interface WriterChapter { path: string; title: string; words: number }
export interface WriterBook { name: string; chapters: WriterChapter[] }
export interface WriterSnapshot { id: string; created: string; words: number }
export interface WriterSettings {
  font: string
  fontSize: number
  pageSize: 'letter' | 'a4'
  margin: number
  lineSpacing: number
  firstLineIndent: number
  layout: 'pages' | 'continuous'
  smartTypography: boolean
  spellcheck: boolean
  dailyGoal: number
  sessionGoal: number
  header: string
  pageNumbers: boolean
}
export const DEFAULT_SETTINGS: WriterSettings = {
  font: 'Fraunces', fontSize: 17, pageSize: 'letter', margin: 72,
  lineSpacing: 1.85, firstLineIndent: 0, layout: 'pages',
  smartTypography: true, spellcheck: true, dailyGoal: 1000, sessionGoal: 500,
  header: '', pageNumbers: true,
}
export interface WriterBridge {
  read(): { path: string; title: string; content: string; selection: string; comments: { type: string; text: string; before?: string; after?: string }[]; canDraft: boolean }
  comment(input: { quote: string; text: string }): Promise<{ ok: true }>
  suggest(input: { quote: string; replacement: string; reason?: string }): Promise<{ ok: true }>
  replace(input: { content: string }): Promise<{ ok: true }>
}
