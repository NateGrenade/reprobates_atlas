// Small fuzzy matcher: subsequence match scored for word starts, runs and prefix.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim()
  if (!q) return 0
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) return 1000 - direct * 2 - (t.length - q.length) * 0.5 + (direct === 0 ? 200 : 0) + (/[\s/_-]/.test(t[direct - 1] ?? ' ') ? 100 : 0)
  let score = 0, ti = 0, run = 0, first = -1
  for (const ch of q) {
    if (ch === ' ') continue
    const at = t.indexOf(ch, ti)
    if (at < 0) return null
    const wordStart = at === 0 || /[\s/_-]/.test(t[at - 1])
    run = at === ti ? run + 1 : 0
    score += 10 + (wordStart ? 25 : 0) + run * 8 - Math.min(20, at - ti)
    if (first < 0) first = at
    ti = at + 1
  }
  // reject scattered matches (letters spread across the whole string)
  if (ti - first > q.replace(/ /g, '').length * 3) return null
  return score - t.length * 0.2
}
