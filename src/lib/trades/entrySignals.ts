import { rsi, sma } from '../backtest/indicators'
import type { EntryMethod } from '../storage/schema'
import type { Bar } from '../market/priceHistory'

// Entry-condition monitoring (handbook 10 §6.4): three rules checked on
// the latest daily bar of each watched symbol. A signal only suggests
// drafting a trade plan; the plan and the pre-trade checklist still decide.

export type EntrySignalKind = 'breakout' | 'pullback' | 'oversold'

export const ENTRY_SIGNAL_LABELS: Record<EntrySignalKind, string> = { breakout: '突破', pullback: '拉回', oversold: 'RSI 超賣' }
export const ENTRY_SIGNAL_METHOD: Record<EntrySignalKind, EntryMethod> = { breakout: 'breakout', pullback: 'pullback', oversold: 'mean_reversion' }

export const ENTRY_RULES = {
  breakoutDays: 55,
  volumeDays: 20,
  pullbackBand: 0.02,
  pullbackRsiLow: 40,
  pullbackRsiHigh: 50,
  slopeSessions: 20,
  oversoldRsi: 10,
  maxSymbols: 15,
} as const

export interface EntrySignal {
  kind: EntrySignalKind
  date: string
  close: number
  detail: string
}

const at = (xs: number[], i: number) => (i >= 0 && Number.isFinite(xs[i]) ? xs[i] : NaN)

export function entrySignals(bars: Bar[]): EntrySignal[] {
  const n = bars.length
  if (n < 210) return []
  const closes = bars.map((b) => b.close)
  const i = n - 1
  const last = bars[i]
  const s20 = sma(closes, 20)
  const s200 = sma(closes, 200)
  const r14 = rsi(closes, 14)
  const r2 = rsi(closes, 2)
  const vol20 = sma(bars.map((b) => b.volume), ENTRY_RULES.volumeDays)
  const out: EntrySignal[] = []
  const R = ENTRY_RULES

  const priorHigh = Math.max(...closes.slice(i - R.breakoutDays, i))
  const volRatio = at(vol20, i - 1) > 0 ? last.volume / at(vol20, i - 1) : NaN
  if (last.close > priorHigh && volRatio > 1) out.push({ kind: 'breakout', date: last.date, close: last.close, detail: `收盤 ${last.close} 創 ${R.breakoutDays} 日新高，成交量 ${volRatio.toFixed(1)} 倍` })

  const rising = at(s200, i) > at(s200, i - R.slopeSessions)
  const near = Math.abs(last.close / at(s20, i) - 1) <= R.pullbackBand
  const rsi14 = at(r14, i)
  if (rising && near && rsi14 >= R.pullbackRsiLow && rsi14 <= R.pullbackRsiHigh) {
    out.push({ kind: 'pullback', date: last.date, close: last.close, detail: `200 日線向上，回到 20 日線附近，RSI(14) ${rsi14.toFixed(0)}` })
  }

  const rsi2 = at(r2, i)
  if (last.close > at(s200, i) && rsi2 < R.oversoldRsi) out.push({ kind: 'oversold', date: last.date, close: last.close, detail: `在 200 日線之上，RSI(2) ${rsi2.toFixed(0)}` })
  return out
}
