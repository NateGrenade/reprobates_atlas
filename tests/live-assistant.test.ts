import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  vault: { root: '/vault', name: 'vault' }, files: new Map<string, string | null>(), liveAsk: null as any,
  setLiveAsk: vi.fn((a: any) => { state.liveAsk = a }),
  applyChanges: vi.fn((pairs: [string, string][]) => { for (const [path, text] of pairs) state.files.set(path, text) }),
  writeFile: vi.fn(async (path: string, text: string) => { state.files.set(path, text) })
}))
vi.mock('../src/renderer/src/store', () => ({ useStore: { getState: () => state } }))

beforeEach(() => {
  state.files.clear()
  state.liveAsk = null
  vi.clearAllMocks()
  ;(globalThis as any).window = { atlas: { create: vi.fn(async () => true) } }
})

describe('assistant file approvals', () => {
  it('shows the exact edit and writes only after approval', async () => {
    const { live } = await import('../src/renderer/src/live')
    state.files.set('Places/World.md', 'old detail')
    const pending = live.proposeFile({ path: 'Places/World.md', before: 'old', after: 'new' })
    expect(state.liveAsk.lines).toEqual(['Replace:', 'old', 'With:', 'new'])
    expect(state.writeFile).not.toHaveBeenCalled()
    state.liveAsk.answer(true)
    expect(await pending).toEqual({ saved: true, path: 'Places/World.md' })
    expect(state.writeFile).toHaveBeenCalledWith('Places/World.md', 'new detail')
  })
  it('does not write a skipped or stale proposal', async () => {
    const { live } = await import('../src/renderer/src/live')
    state.files.set('World.md', 'old')
    const skipped = live.proposeFile({ path: 'World.md', before: 'old', after: 'new' })
    state.liveAsk.answer(false)
    expect((await skipped).saved).toBe(false)
    const stale = live.proposeFile({ path: 'World.md', before: 'old', after: 'new' })
    state.files.set('World.md', 'changed')
    state.liveAsk.answer(true)
    await expect(stale).rejects.toThrow('changed while approval')
    expect(state.writeFile).not.toHaveBeenCalled()
  })
  it('creates only after approval and refuses ambiguous replacements', async () => {
    const { live } = await import('../src/renderer/src/live')
    const pending = live.proposeFile({ path: 'Places/New.md', content: '# New' })
    expect(window.atlas.create).not.toHaveBeenCalled()
    state.liveAsk.answer(true)
    await pending
    expect(window.atlas.create).toHaveBeenCalledWith('Places/New.md', '# New')
    await expect(live.proposeFile({ path: 'Manuscript/Book/Chapter.md', content: 'Prose' })).rejects.toThrow('Use Writer tools')
    state.files.set('World.md', 'old old')
    await expect(live.proposeFile({ path: 'World.md', before: 'old', after: 'new' })).rejects.toThrow('exactly once')
  })
})

describe('Writer approvals', () => {
  it('blocks drafting without permission and applies comments only after approval', async () => {
    const { live } = await import('../src/renderer/src/live')
    const writer = { read: () => ({ path: 'Draft.md', title: 'Draft', content: 'A passage', canDraft: false }), comment: vi.fn(async () => ({ ok: true })) }
    ;(window as any).__atlasWriter = writer
    await expect(live.writerChange({ action: 'replace', content: 'New prose' })).rejects.toThrow('Drafting must be enabled')
    const pending = live.writerChange({ action: 'comment', quote: 'A passage', text: 'A note' })
    expect(writer.comment).not.toHaveBeenCalled()
    state.liveAsk.answer(true)
    await pending
    expect(writer.comment).toHaveBeenCalledWith({ quote: 'A passage', text: 'A note' })
  })
})
