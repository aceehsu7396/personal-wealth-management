import type { Bar } from '../market/priceHistory'

// Indicator arrays align with the bar array; values before enough history
// exist are NaN.

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

// Wilder's RSI.
export function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  out[period] = value()
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = value()
  }
  return out
}

// Wilder's average true range.
export function atr(bars: Bar[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN)
  if (bars.length <= period) return out
  const tr = bars.map((b, i) =>
    i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)),
  )
  let avg = tr.slice(1, period + 1).reduce((a, v) => a + v, 0) / period
  out[period] = avg
  for (let i = period + 1; i < bars.length; i++) {
    avg = (avg * (period - 1) + tr[i]) / period
    out[i] = avg
  }
  return out
}

// Highest high / lowest low of the `period` bars before i (excluding i).
export function priorHigh(bars: Bar[], period: number): number[] {
  return bars.map((_, i) => (i < period ? NaN : Math.max(...bars.slice(i - period, i).map((b) => b.high))))
}

export function priorLow(bars: Bar[], period: number): number[] {
  return bars.map((_, i) => (i < period ? NaN : Math.min(...bars.slice(i - period, i).map((b) => b.low))))
}
