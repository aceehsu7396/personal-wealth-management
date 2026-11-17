import { adjustBars, detectSplits, type Bar } from '../market/priceHistory'
import { atr, priorHigh, priorLow, rsi, sma } from '../backtest/indicators'
import type { PriceRow } from './etfProfile'
import { DEFAULT_DECISION_DAY, weeklyBars } from '../backtest/weekly'

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
  // The weekly view (handbook 10 §6.6), from the same daily prices; the
  // current week counts with its latest close.
  weekly?: WeeklyTechnical
}

export interface WeeklyTechnical {
  sma10w: number | null
  sma30w: number | null
  // The 30-week line higher than a week ago.
  sma30wRising: boolean | null
  // Highest high of the 20 weeks and lowest low of the 10 weeks before this one.
  high20w: number | null
  low10w: number | null
  rsi3w: number | null
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
    weekly: weeklyTechnical(bars),
  }
}

function weeklyTechnical(daily: Bar[]): WeeklyTechnical {
  const weeks = weeklyBars(daily, DEFAULT_DECISION_DAY).bars
  const closes = weeks.map((b) => b.close)
  const j = weeks.length - 1
  const s30 = sma(closes, 30)
  return {
    sma10w: valueAt(sma(closes, 10), j),
    sma30w: valueAt(s30, j),
    sma30wRising: Number.isFinite(s30[j]) && Number.isFinite(s30[j - 1]) ? s30[j] > s30[j - 1] : null,
    high20w: valueAt(priorHigh(weeks, 20), j),
    low10w: valueAt(priorLow(weeks, 10), j),
    rsi3w: valueAt(rsi(closes, 3), j),
  }
}
