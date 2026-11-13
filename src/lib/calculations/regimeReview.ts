import type { RegimeKey } from '../storage/schema'
import type { RegimeSegment } from '../market/regime'

// Hindsight check of the regime rules (handbook 05 §8.3): was each regime
// followed by the move it braced for? Used only as evidence for the yearly
// review; thresholds are never tuned automatically.

export type Verdict = 'right' | 'wrong' | 'unclear' | 'unscored' | 'pending'

export const VERDICT_LABELS: Record<Verdict, string> = {
  right: '正確',
  wrong: '錯誤',
  unclear: '不明',
  unscored: '不計分',
  pending: '還沒到 3 個月',
}

export const REVIEW_RULES = { missBy: 5, lateDrawdown: -15, whipsawSessions: 10 } as const

const DEFENSIVE: RegimeKey[] = ['correction', 'bear', 'crash']
const OFFENSIVE: RegimeKey[] = ['bull', 'overheated', 'rebound']

export interface SegmentReview {
  segment: RegimeSegment
  verdict: Verdict
  late: boolean
  whipsaw: boolean
}

// drawdownAt: the index drawdown (%) on a date; sessions: trading days in
// the segment.
export function reviewSegment(segment: RegimeSegment, sessions: number, drawdownAtConfirm: number | null): SegmentReview {
  const m3 = segment.after.m3
  let verdict: Verdict
  if (!DEFENSIVE.includes(segment.regime) && !OFFENSIVE.includes(segment.regime)) verdict = 'unscored'
  else if (m3 === null) verdict = 'pending'
  else if (DEFENSIVE.includes(segment.regime)) verdict = m3 < 0 ? 'right' : m3 > REVIEW_RULES.missBy ? 'wrong' : 'unclear'
  else verdict = m3 > 0 ? 'right' : m3 < -REVIEW_RULES.missBy ? 'wrong' : 'unclear'
  return {
    segment,
    verdict,
    late: DEFENSIVE.includes(segment.regime) && drawdownAtConfirm !== null && drawdownAtConfirm <= REVIEW_RULES.lateDrawdown,
    whipsaw: sessions < REVIEW_RULES.whipsawSessions,
  }
}

export function reviewHistory(segments: RegimeSegment[], dates: string[], drawdownOn: (date: string) => number | null): { rows: SegmentReview[]; hitRate: number | null; scored: number } {
  const index = new Map(dates.map((d, i) => [d, i]))
  const rows = segments.map((s, k) => {
    const start = index.get(s.start) ?? 0
    const next = segments[k + 1]
    const end = next ? (index.get(next.start) ?? dates.length) : dates.length
    return reviewSegment(s, end - start, drawdownOn(s.confirmedOn))
  })
  const scored = rows.filter((r) => r.verdict === 'right' || r.verdict === 'wrong')
  return { rows, scored: scored.length, hitRate: scored.length ? scored.filter((r) => r.verdict === 'right').length / scored.length : null }
}
