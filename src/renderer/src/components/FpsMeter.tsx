import { useEffect, useRef } from 'react'

/** Dev FPS counter: current fps, plus min and average over the last 10 s. */
export function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frames: [number, number][] = [] // [time, dt]
    let lastPaint = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      frames.push([now, dt])
      while (frames.length && now - frames[0][0] > 10000) frames.shift()
      if (now - lastPaint > 250 && ref.current) {
        lastPaint = now
        const recent = frames.filter((f) => now - f[0] < 1000)
        const fps = recent.length
        const worst = Math.max(...frames.map((f) => f[1]))
        const avg = frames.length / ((now - frames[0][0]) / 1000 || 1)
        ref.current.innerHTML = `<b>${fps}</b> fps<br>10s avg ${avg.toFixed(0)} · worst ${(1000 / worst).toFixed(0)}`
        ;(window as any).__atlasFps = { fps, avg, worstFps: 1000 / worst }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <div className="fps" ref={ref} />
}
