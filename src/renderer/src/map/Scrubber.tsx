// Time scrubber for the living map, bound to the shared time cursor (the Timeline's cursor too).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultIndex } from '@core/vault'
import { formatKey } from '@core/config'
import { useStore } from '../store'

const toDate = (k: number, dpy: number) => {
  const year = Math.floor(k / dpy)
  return { year, day: Math.floor(k - year * dpy) + 1 }
}

export function Scrubber({ ix }: { ix: VaultIndex }) {
  const cursor = useStore((s) => s.timeCursor)
  const setCursor = useStore((s) => s.setTimeCursor)
  const dpy = ix.config.days_per_year
  const located = useMemo(() => ix.beats.filter((b) => b.location), [ix])
  const [playing, setPlaying] = useState(false)
  const anim = useRef<{ stop(): void } | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const range = useMemo(() => {
    if (!located.length) return null
    const lo = Math.min(...located.map((b) => b.key)), hi = Math.max(...located.map((b) => b.endKey ?? b.key))
    const pad = Math.max((hi - lo) * 0.12, 3)
    return { lo: lo - pad, hi: hi + pad }
  }, [located])
  useEffect(() => () => anim.current?.stop(), [])
  if (!range) return null
  const frac = (k: number) => (k - range.lo) / (range.hi - range.lo)
  const fromX = (x: number) => {
    const r = bar.current!.getBoundingClientRect()
    return range.lo + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (range.hi - range.lo)
  }
  const play = () => {
    if (playing) {
      anim.current?.stop()
      setPlaying(false)
      return
    }
    const start = cursor >= range.hi - 1 || cursor < range.lo ? range.lo : cursor
    setPlaying(true)
    // plain requestAnimationFrame loop (motion's animate() blocked the main thread for the whole run here)
    const dur = Math.max(3, 9 * ((range.hi - start) / (range.hi - range.lo))) * 1000
    let raf = 0, t0 = 0
    const tick = (t: number) => {
      if (!t0) t0 = t
      const u = Math.min(1, (t - t0) / dur)
      setCursor(start + (range.hi - start) * u)
      if (u < 1) raf = requestAnimationFrame(tick)
      else setPlaying(false)
    }
    raf = requestAnimationFrame(tick)
    anim.current = { stop: () => cancelAnimationFrame(raf) }
  }
  const onDown = (e: React.PointerEvent) => {
    anim.current?.stop()
    setPlaying(false)
    setCursor(fromX(e.clientX))
    const move = (ev: PointerEvent) => setCursor(fromX(ev.clientX))
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const inRange = cursor >= range.lo && cursor <= range.hi
  return (
    <div className="scrubber">
      <button className={`scrub-play${playing ? ' on' : ''}`} onClick={play} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play the story forward in time: characters move between places as events happen'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="scrub-bar" ref={bar} onPointerDown={onDown} title="Story time. Drag to move through it; ticks are events that happen at a place">
        <div className="scrub-track" />
        {located.map((b) => (
          <div key={b.id} className={`scrub-tick move-${b.move ?? 'none'}`} style={{ left: `${frac(b.key) * 100}%` }} title={b.title} />
        ))}
        {inRange && <div className="scrub-fill" style={{ width: `${frac(cursor) * 100}%` }} />}
        {inRange && <div className="scrub-knob" style={{ left: `${frac(cursor) * 100}%` }} />}
      </div>
      <div className="scrub-label">{formatKey(ix.config, cursor)}</div>
    </div>
  )
}
