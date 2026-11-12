import type { ScenarioSet } from '../storage/schema'

// Probability calibration (blueprint 02 §2.2): Brier score per resolved
// scenario set, and how often each probability band came true.

export const probabilityTotal = (set: Pick<ScenarioSet, 'scenarios'>) => set.scenarios.reduce((a, s) => a + s.probability, 0)
export const isBalanced = (set: Pick<ScenarioSet, 'scenarios'>) => Math.abs(probabilityTotal(set) - 100) < 0.5

// Σ (p − o)² over the set's scenarios: 0 is perfect; spreading evenly over
// n scenarios scores 1 − 1/n.
export function brierScore(set: ScenarioSet): number | null {
  if (set.outcome === undefined) return null
  return set.scenarios.reduce((a, s, i) => a + (s.probability / 100 - (i === set.outcome ? 1 : 0)) ** 2, 0)
}

export const evenGuessScore = (n: number) => 1 - 1 / n

export interface CalibrationSummary {
  resolved: number
  brier: number | null
  // The same sets scored as if every scenario got an equal share.
  baseline: number | null
  bands: { label: string; predicted: number | null; observed: number | null; count: number }[]
}

const BANDS = [0, 20, 40, 60, 80, 100.01]
export const MIN_BAND_COUNT = 3

export function calibration(sets: ScenarioSet[]): CalibrationSummary {
  const resolved = sets.filter((s) => s.outcome !== undefined)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const points = resolved.flatMap((s) => s.scenarios.map((x, i) => ({ p: x.probability, hit: i === s.outcome ? 1 : 0 })))
  const bands = BANDS.slice(0, -1).map((lo, k) => {
    const hi = BANDS[k + 1]
    const inBand = points.filter((x) => x.p >= lo && x.p < hi)
    return {
      label: `${lo}–${Math.round(hi)}%`,
      predicted: mean(inBand.map((x) => x.p / 100)),
      observed: mean(inBand.map((x) => x.hit)),
      count: inBand.length,
    }
  })
  return {
    resolved: resolved.length,
    brier: mean(resolved.map((s) => brierScore(s)!)),
    baseline: mean(resolved.map((s) => evenGuessScore(s.scenarios.length))),
    bands,
  }
}
