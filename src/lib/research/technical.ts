import { adjustBars, detectSplits, type Bar } from '../market/priceHistory'
import { atr, priorHigh, priorLow, rsi, sma } from '../backtest/indicators'
import type { PriceRow } from './etfProfile'

// Trend and momentum on the latest close (handbook chapter 07 §2.6), from
// the daily prices FinMind already provides. Splits are adjusted so that
// averages and highs are not distorted.

export interface TechnicalSnapshot {
  date: string
  close: number
  sma20: number | null
  sma60: number | null
  sma120: number | null
  sma200: number | null
  // Highest high of the 55 days and lowest low of the 20 days before today.
  high55: number | null
  low20: number | null
  rsi14: number | null
  atr14: number | null
  ret6m: number | null
  ret12m: number | null
  // A 20/120-day crossover within the last five sessions.
  cross: 'golden' | 'death' | null
}

const TRADING_DAYS = { m6: 126, m12: 252 } as const
const CROSS_LOOKBACK = 5

const valueAt = (series: number[], i: number) => (i >= 0 && Number.isFinite(series[i]) ? Math.round(series[i] * 100) / 100 : null)

export function technicalSnapshot(prices: PriceRow[]): TechnicalSnapshot | null {
  const raw: Bar[] = [...prices]
    .filter((p) => p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, open: p.open || p.close, high: p.max || p.close, low: p.min || p.close, close: p.close, volume: 0 }))
  if (raw.length < 25) return null
  const bars = adjustBars(raw, detectSplits(raw))
  const closes = bars.map((b) => b.close)
  const i = bars.length - 1
  const s20 = sma(closes, 20)
  const s120 = sma(closes, 120)

  let cross: TechnicalSnapshot['cross'] = null
  for (let k = Math.max(i - CROSS_LOOKBACK + 1, 1); k <= i; k++) {
    if (![s20[k], s120[k], s20[k - 1], s120[k - 1]].every(Number.isFinite)) continue
    if (s20[k] > s120[k] && s20[k - 1] <= s120[k - 1]) cross = 'golden'
    if (s20[k] < s120[k] && s20[k - 1] >= s120[k - 1]) cross = 'death'
  }
  const ret = (days: number) => (i - days >= 0 ? Math.round((closes[i] / closes[i - days] - 1) * 10_000) / 100 : null)

  return {
    date: bars[i].date,
    // The real (unadjusted) close, comparable with fair values and costs.
    close: raw[i].close,
    sma20: valueAt(s20, i),
    sma60: valueAt(sma(closes, 60), i),
    sma120: valueAt(s120, i),
    sma200: valueAt(sma(closes, 200), i),
    high55: valueAt(priorHigh(bars, 55), i),
    low20: valueAt(priorLow(bars, 20), i),
    rsi14: valueAt(rsi(closes, 14), i),
    atr14: valueAt(atr(bars, 14), i),
    ret6m: ret(TRADING_DAYS.m6),
    ret12m: ret(TRADING_DAYS.m12),
    cross,
  }
}
