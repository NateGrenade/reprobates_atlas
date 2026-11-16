// The Apply / Skip card for a change an agent wants to save (Atlas Live). Every caller, in-app or outside,
// goes through this one gate; nothing is written until the user presses Apply.
import { useStore } from '../store'

export function LiveAsk() {
  const ask = useStore((s) => s.liveAsk)
  if (!ask) return null
  return (
    <div className="live-ask" role="dialog" aria-label="Change waiting for approval">
      <div className="live-ask-title">{ask.title}</div>
      <ul>
        {ask.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <div className="live-ask-actions">
        <button className="chip-btn primary" onClick={() => ask.answer(true)}>
          Apply
        </button>
        <button className="chip-btn" onClick={() => ask.answer(false)}>
          Skip
        </button>
      </div>
    </div>
  )
}
