export interface FuzzyMatchResult {
  score: number
  positions: number[]
}

/**
 * Simple subsequence fuzzy matcher (VSCode-like).
 * Matches `query` against `target` case-insensitively.
 * Returns null when there is no match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let score = 0
  let qi = 0
  let lastIndex = -1
  const positions: number[] = []

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti)
      // consecutive match bonus
      if (lastIndex === ti - 1) score += 8
      else score += 2
      // start-of-word bonus
      if (ti === 0 || /[\s/\\._-]/.test(t[ti - 1] ?? '')) score += 6
      // basename-hit bonus handled by caller via order
      lastIndex = ti
      qi++
    }
  }

  if (qi < q.length) return null

  // shorter targets are better
  score += Math.max(0, 20 - t.length / 4)

  return { score, positions }
}

export interface RankableItem {
  label: string
  detail?: string
  [key: string]: unknown
}

export function rankItems<T extends RankableItem>(query: string, items: T[], limit = 50): Array<{ item: T; score: number }> {
  const results: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const labelResult = fuzzyMatch(query, item.label)
    const detailResult = item.detail ? fuzzyMatch(query, item.detail) : null
    const best = labelResult && detailResult ? Math.max(labelResult.score + 10, detailResult.score) : labelResult ? labelResult.score + 10 : detailResult ? detailResult.score : null
    if (best !== null) {
      results.push({ item, score: best })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}
