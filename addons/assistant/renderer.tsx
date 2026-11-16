// Assistant add-on, window side: the Cmd+J prompt bar. The conversation itself runs in main.ts and keeps
// going when this is hidden.
import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import type { AddonApi } from '../../src/renderer/src/addons/host'
import type { Provider, ProviderStatus, Session, ModelOption, Selection } from './types'
import css from './style.css'

const md = new MarkdownIt({ html: false, linkify: false, breaks: true })
const NAMES: Record<Provider, string> = { claude: 'Claude', codex: 'Codex', fake: 'Test' }
const APPS: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex', fake: '' }

export default function activate(api: AddonApi) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  let toggle: () => void = () => {}

  function Bar() {
    const [open, setOpen] = useState(false)
    const [status, setStatus] = useState<Record<string, ProviderStatus>>({})
    const [provider, setProvider] = useState<Provider>((localStorage.getItem('assistant.provider') as Provider) || 'claude')
    const [models, setModels] = useState<ModelOption[]>([])
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [choices, setChoices] = useState<Record<string, Selection>>(() => {
      try { return JSON.parse(localStorage.getItem('assistant.choices') || '{}') } catch { return {} }
    })
    const [session, setSession] = useState<Session | null>(null)
    const [history, setHistory] = useState<Session[] | null>(null)
    const [running, setRunning] = useState<Record<string, boolean>>({})
    const [text, setText] = useState('')
    const [error, setError] = useState('')
    const input = useRef<HTMLTextAreaElement>(null)
    const log = useRef<HTMLDivElement>(null)
    const current = useRef<string | null>(null)
    const isOpen = useRef(false)
    current.current = session?.id ?? null
    isOpen.current = open
    toggle = () => setOpen((o) => !o)

    const view = api.store((s) => s.view)
    const selected = api.store((s) => s.selected)
    const level = api.store((s) => s.mapFocus)
    const name = (p?: string | null) => p?.split('/').pop()?.replace(/\.md$/, '')
    const context = [view.startsWith('addon:') ? null : view[0].toUpperCase() + view.slice(1), view === 'map' && level ? `in ${name(level)}` : null, selected ? `${name(selected)} selected` : null].filter(Boolean).join(' · ')

    useEffect(() => {
      const a = api.ipc.on('session', (s: Session) => {
        setRunning((r) => ({ ...r, [s.id]: s.running }))
        if (s.id === current.current) setSession(s)
      })
      const b = api.ipc.on('finished', (f: { id: string; title: string; error?: string }) => {
        if (!isOpen.current || f.id !== current.current) api.toast(f.error ? `Assistant stopped: ${f.error}` : `Assistant finished: “${f.title}” (press ⌘J to read it)`)
      })
      return () => (a(), b())
    }, [])
    useEffect(() => {
      if (!open) return
      input.current?.focus()
      api.ipc.invoke('status').then((s) => {
        setStatus(s)
        if (!s[provider]?.signedIn) {
          const ok = (Object.keys(s) as Provider[]).find((p) => s[p].signedIn)
          if (ok) setProvider(ok)
        }
      })
    }, [open])
    useEffect(() => {
      log.current?.scrollTo({ top: log.current.scrollHeight })
    }, [session])
    useEffect(() => {
      const el = input.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 140) + 'px'
    }, [text, open])

    const busy = !!session?.running
    const anyRunning = useMemo(() => Object.values(running).some(Boolean), [running])
    const active = session?.provider ?? provider
    const ready = status[active]?.signedIn
    useEffect(() => {
      if (!open || !ready) return
      let alive = true
      setModels([])
      api.ipc.invoke('models', active).then((options: ModelOption[]) => { if (alive) setModels(options) })
      return () => { alive = false }
    }, [active, open, ready])
    const selection = choices[active] ?? { model: '', effort: '' }
    const selectedModel = models.find((m) => m.value === selection.model) ?? (!selection.model && active === 'claude' ? models.find((m) => m.value === 'default') : undefined)
    const choose = (next: Selection) => {
      const all = { ...choices, [active]: next }
      setChoices(all)
      localStorage.setItem('assistant.choices', JSON.stringify(all))
    }
    const send = async () => {
      const t = text.trim()
      if (!t || busy || !ready) return
      setText('')
      setError('')
      setHistory(null)
      try {
        const id = await api.ipc.invoke('send', { id: session?.id, provider: active, text: t, selection })
        current.current = id
        setSession(await api.ipc.invoke('get', id))
      } catch (e: any) {
        setError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': Error: /, ''))
        setText(t)
      }
    }
    const pick = (p: Provider) => {
      setProvider(p)
      localStorage.setItem('assistant.provider', p)
      setSession(null)
      input.current?.focus()
    }

    // links in a reply open in the browser, never inside the app window
    const openLink = (e: { target: EventTarget; preventDefault(): void }) => {
      const a = (e.target as HTMLElement).closest?.('a')
      if (!a) return
      e.preventDefault()
      void window.atlas.openExternal(a.getAttribute('href') ?? '')
    }

    if (!open) return anyRunning ? (
      <button className="asst-pulse" onClick={() => setOpen(true)}>
        <i /> Assistant is working
      </button>
    ) : null
    return (
      <div className="asst" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}>
        {(session || history) && (
          <div className="asst-panel">
            <div className="asst-head">
              {busy && <span className="asst-dot" />}
              <span className="asst-title">{history ? 'Earlier conversations in this vault' : session?.title}</span>
              {session && !history && session.remoteId && session.provider !== 'fake' && (
                <button onClick={() => api.ipc.invoke('openInApp', session.id)} title={`Open this same conversation in ${APPS[session.provider]}, in a terminal`}>
                  Continue in {APPS[session.provider]}
                </button>
              )}
              {busy && <button onClick={() => api.ipc.invoke('stop', session!.id)}>Stop</button>}
              <button onClick={() => (setSession(null), setHistory(null), input.current?.focus())}>New</button>
            </div>
            {history ? (
              <div className="asst-list">
                {history.length ? history.map((h) => (
                  <button key={h.id} onClick={async () => (setSession(await api.ipc.invoke('get', h.id)), setHistory(null))}>
                    <span>{h.title}</span>
                    <span>{NAMES[h.provider]}{running[h.id] ? ' · working' : ''}</span>
                  </button>
                )) : <div className="asst-empty">Nothing yet.</div>}
              </div>
            ) : (
              <div className="asst-log" ref={log} onClick={openLink}>
                {session!.messages.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="asst-user">{m.steps[0]?.text}</div>
                  ) : (
                    <div key={i} className="asst-reply">
                      {m.steps.map((s, j) => (s.kind === 'tool' ? <div key={j} className="asst-tool">{s.text}</div> : <div key={j} dangerouslySetInnerHTML={{ __html: md.render(s.text) }} />))}
                      {m.error && <div className="asst-error">{m.error}</div>}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
        <div className="asst-bar">
          <textarea
            ref={input}
            rows={1}
            value={text}
            placeholder={ready === false ? status[active]?.detail : session ? 'Reply…' : 'Ask about what is on screen, or tell the Atlas where to go'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="asst-foot">
            <span className="asst-ctx">{error || (context ? `Sees: ${context}` : '')}</span>
            {!session && (Object.keys(status) as Provider[]).map((p) => (
              <button key={p} className={p === provider ? 'on' : ''} disabled={!status[p].signedIn} title={status[p].detail} onClick={() => pick(p)}>
                {NAMES[p]}
              </button>
            ))}
            {active !== 'fake' && <div className="asst-model-wrap">
              <button aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>{selection.model ? (selectedModel?.label ?? selection.model) : 'Model'}{selection.effort ? ` · ${selection.effort}` : ''} ▾</button>
              {settingsOpen && <div className="asst-model-menu">
                <label>Model<select value={selection.model} onChange={(e) => choose({ model: e.target.value, effort: '' })}>
                  <option value="">Provider default</option>
                  {models.map((m) => <option value={m.value} key={m.value}>{m.label}</option>)}
                </select></label>
                <label>Reasoning<select value={selection.effort} onChange={(e) => choose({ ...selection, effort: e.target.value })}>
                  <option value="">Provider default</option>
                  {(selectedModel?.efforts ?? (active === 'codex' ? ['low', 'medium', 'high', 'xhigh', 'max'] : [])).map((e) => <option key={e} value={e}>{e}</option>)}
                </select></label>
                {!models.length && <small>Model list unavailable; provider default will be used.</small>}
              </div>}
            </div>}
            <button onClick={async () => setHistory(history ? null : await api.ipc.invoke('list'))}>History</button>
            <button className="send" disabled={!text.trim() || busy || !ready} onClick={send}>
              Send
            </button>
          </div>
        </div>
      </div>
    )
  }

  function Pane() {
    const [status, setStatus] = useState<Record<string, ProviderStatus> | null>(null)
    useEffect(() => void api.ipc.invoke('status').then(setStatus), [])
    return (
      <div className="asst-settings">
        <p style={{ color: 'var(--text-2)' }}>Press ⌘J (Ctrl+J on Windows) anywhere to ask the assistant. It uses the Claude Code or Codex already signed in on this computer; this add-on holds no key or account of its own.</p>
        {status ? (['claude', 'codex'] as Provider[]).map((p) => (
          <div className="prefs-row" key={p}>
            <div className="prefs-row-k">{APPS[p]}</div>
            <div className="prefs-row-v">{status[p]?.detail}</div>
          </div>
        )) : <p>Checking sign-in…</p>}
      </div>
    )
  }

  api.overlays.register({ id: 'bar', component: Bar })
  api.commands.register({ id: 'ask', title: 'Ask the assistant', detail: 'prompt bar: Claude or Codex, sees the Atlas', shortcut: 'mod+j', run: () => toggle() })
  api.settings.register({ title: 'Assistant', render: () => <Pane /> })
  return () => style.remove()
}
