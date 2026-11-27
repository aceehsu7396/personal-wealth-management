import { describe, expect, it } from 'vitest'
import { addDay, emptyHistory, HISTORY_DAYS, missingDays, yearStats } from './closeHistory'

const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)

describe('close history', () => {
  it('adds days in order, replaces a repeated day and keeps the window', () => {
    let h = emptyHistory()
    h = addDay(h, '2026-11-26', new Map([['2330', 1000]]))
    h = addDay(h, '2026-11-25', new Map([['2330', 990], ['0050', 60]]))
    h = addDay(h, '2026-11-26', new Map([['2330', 1005], ['0050', 61]]))
    expect(h.dates).toEqual(['2026-11-25', '2026-11-26'])
    expect(h.closes['2330']).toEqual([990, 1005])
    expect(h.closes['0050']).toEqual([60, 61])
    for (let i = 0; i < HISTORY_DAYS + 5; i++) h = addDay(h, day(i), new Map([['2330', 1]]))
    expect(h.dates).toHaveLength(HISTORY_DAYS)
    expect(h.dates.at(-1)).toBe('2026-11-26')
  })

  it('lists missing weekdays newest first, skipping known and closed days', () => {
    const h = { ...emptyHistory(), dates: ['2026-11-25'], closed: ['2026-11-24'] }
    const miss = missingDays(h, '2026-11-26')
    expect(miss.slice(0, 2)).toEqual(['2026-11-23', '2026-11-20'])
    expect(miss).not.toContain('2026-11-22')
    expect(miss.length).toBeGreaterThan(250)
  })

  it('computes annualized volatility and distance from the high', () => {
    // Alternating ±1%: daily sd about 1%, so about 15.9% a year.
    const series = Array.from({ length: 252 }, (_, i) => 100 * (i % 2 ? 1.01 : 1))
    // A peak of 120 reached and left within the ±10% daily limit.
    Object.assign(series, { 97: 105, 98: 110, 99: 115, 100: 120, 101: 115, 102: 110, 103: 105 })
    const s = yearStats(series)
    expect(s.fromHigh52).toBeCloseTo(series.at(-1)! / 120 - 1, 6)
    expect(s.vol1y).toBeGreaterThan(0.15)
  })

  it('gives nothing for a short history or a split', () => {
    expect(yearStats(Array(200).fill(10))).toEqual({ vol1y: null, fromHigh52: null })
    const split = Array.from({ length: 252 }, (_, i) => (i < 150 ? 100 : 50))
    expect(yearStats(split)).toEqual({ vol1y: null, fromHigh52: null })
  })
})
