import { describe, expect, it } from 'vitest'
import { entrySignals } from './entrySignals'
import type { Bar } from '../market/priceHistory'

const series = (closes: number[], volumes?: number[]): Bar[] =>
  closes.map((close, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: volumes?.[i] ?? 1000 }))

// A slow uptrend with ±1 swings.
const base = Array.from({ length: 260 }, (_, i) => 100 + i * 0.05 + (i % 2 ? 1 : -1))

describe('entry signals', () => {
  it('needs enough history', () => {
    expect(entrySignals(series(base.slice(0, 100)))).toEqual([])
  })

  it('flags a breakout on volume, and not without it', () => {
    const closes = [...base, 150]
    expect(entrySignals(series(closes, [...base.map(() => 1000), 2500])).map((s) => s.kind)).toContain('breakout')
    expect(entrySignals(series(closes, [...base.map(() => 1000), 800])).map((s) => s.kind)).not.toContain('breakout')
  })

  it('flags a sharp short-term drop above the 200-day line as oversold', () => {
    const steep = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1 + (i % 2 ? 1 : -1))
    const closes = [...steep, steep.at(-1)! - 4, steep.at(-1)! - 8, steep.at(-1)! - 9]
    const kinds = entrySignals(series(closes)).map((s) => s.kind)
    expect(kinds).toContain('oversold')
    expect(kinds).not.toContain('breakout')
  })
})
