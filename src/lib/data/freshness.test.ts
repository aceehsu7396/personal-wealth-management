import { describe, expect, it } from 'vitest'
import { checkFreshness, trackHealth, tradingDaysBetween, watchdogDecision, type DataFiles, type HealthFile } from './freshness'

// Monday 2026-11-23, 16:00 Taiwan time.
const NOW = new Date('2026-11-23T08:00:00Z')

const fresh = (): DataFiles => ({
  macro: {
    generatedAt: '2026-11-23T07:00:00Z',
    errors: [],
    series: { T10Y2Y: [{ date: '2026-11-20' }], CPIAUCSL: [{ date: '2026-10-01' }], TW_BUSINESS_SCORE: [{ date: '2026-09-01' }] },
    margin: { now: { date: '2026-11-20' } },
    fubon: [{ reportDate: '2026-10-07' }, { reportDate: '2026-11-04' }],
    fubonLatestListed: { date: '2026-11-09' },
  },
  stocks: { generatedAt: '2026-11-23T07:00:00Z', date: '2026-11-20', errors: [] },
  indices: { generatedAt: '2026-11-23T07:00:00Z', errors: [], series: { TAIEX: [{ date: '2026-11-23' }], GSPC: [{ date: '2026-11-20' }] } },
  valuation: { points: [{ date: '2026-11-20' }] },
  events: { generatedAt: '2026-11-23T07:00:00Z', errors: [] },
  funds: { generatedAt: '2026-11-23T07:00:00Z', errors: [], funds: [['A', 'a', 10, '2026-11-20', 'TWD']] },
  brief: { date: '2026-11-23' },
  dailyResearch: { runs: [{ date: '2026-11-23' }] },
  activeEtf: { generatedAt: '2026-11-23T07:00:00Z', sourceUpdated: '2026-11-20', top: ['00981A'], history: { '00981A': [{ dataDate: '2026-11-20' }] }, errors: [] },
})

const statusOf = (files: DataFiles, key: string, now = NOW) => checkFreshness(files, now).find((i) => i.key === key)!

describe('checkFreshness', () => {
  it('passes data as new as it should be', () => {
    expect(checkFreshness(fresh(), NOW).filter((i) => i.status !== 'ok')).toEqual([])
  })

  it('counts trading days, not weekends', () => {
    expect(tradingDaysBetween('2026-11-20', '2026-11-23')).toBe(1)
    expect(tradingDaysBetween('2026-11-23', '2026-11-23')).toBe(0)
  })

  it('wants today’s close only after 14:30', () => {
    const f = fresh()
    f.indices!.series.TAIEX = [{ date: '2026-11-19' }]
    expect(statusOf(f, 'taiex').status).toBe('late')
    // Monday morning: Friday's close is the newest one due.
    f.indices!.series.TAIEX = [{ date: '2026-11-20' }]
    expect(statusOf(f, 'taiex', new Date('2026-11-23T01:00:00Z')).status).toBe('ok')
  })

  it('catches Fubon behind the issue listed on the site', () => {
    const f = fresh()
    f.macro!.fubon = [{ reportDate: '2026-09-02' }]
    const item = statusOf(f, 'fubon')
    expect(item.status).toBe('late')
    expect(item.note).toContain('2026-11-09')
  })

  it('flags a frozen third-party source and missing files', () => {
    const f = fresh()
    f.activeEtf!.sourceUpdated = '2026-11-10'
    expect(statusOf(f, 'activeEtf').status).toBe('late')
    expect(statusOf({ ...fresh(), stocks: null }, 'stocks').status).toBe('missing')
  })

  it('marks errors as a warning, not a repair', () => {
    const f = fresh()
    f.stocks!.errors = ['月營收：502']
    expect(statusOf(f, 'stocks')).toMatchObject({ status: 'warn', note: expect.stringContaining('月營收') })
  })

  it('expects a research round by the afternoon of each weekday', () => {
    const f = fresh()
    f.dailyResearch!.runs = [{ date: '2026-11-20' }]
    expect(statusOf(f, 'dailyResearch').status).toBe('late')
    expect(statusOf(f, 'dailyResearch', new Date('2026-11-23T02:00:00Z')).status).toBe('ok')
  })
})

describe('trackHealth and the watchdog', () => {
  const late = () => {
    const f = fresh()
    f.stocks!.date = '2026-11-17'
    return checkFreshness(f, NOW)
  }

  it('records when an item went late and what was tried, and clears on repair', () => {
    const first = trackHealth(null, late(), NOW, { stocks: ['stocks-data'] })
    const s = first.items.find((i) => i.key === 'stocks')!
    expect(s).toMatchObject({ status: 'late', since: NOW.toISOString(), attempts: 1, tried: ['stocks-data'] })
    const later = new Date(NOW.getTime() + 3600_000)
    const second = trackHealth(first, late(), later, { stocks: ['stocks-data', 'MI_INDEX'] })
    expect(second.items.find((i) => i.key === 'stocks')).toMatchObject({ since: NOW.toISOString(), attempts: 2, tried: ['stocks-data', 'MI_INDEX'] })
    const fixed = trackHealth(second, checkFreshness(fresh(), later), later)
    expect(fixed.items.find((i) => i.key === 'stocks')).toMatchObject({ status: 'ok', attempts: 0 })
  })

  it('turns stale after 12 hours (the active ETF source after a day)', () => {
    const first = trackHealth(null, late(), NOW)
    const after = new Date(NOW.getTime() + 12 * 3600_000)
    expect(trackHealth(first, late(), after).items.find((i) => i.key === 'stocks')?.status).toBe('stale')
    const f = fresh()
    f.activeEtf!.sourceUpdated = '2026-11-10'
    const e1 = trackHealth(null, checkFreshness(f, NOW), NOW)
    expect(trackHealth(e1, checkFreshness(f, after), after).items.find((i) => i.key === 'activeEtf')?.status).toBe('late')
  })

  it('re-runs late data and notifies only on stale, once a day or when it first turns', () => {
    const ok: HealthFile = trackHealth(null, checkFreshness(fresh(), NOW), NOW, {}, '2026-11-23T07:00:00Z')
    expect(watchdogDecision(ok, NOW)).toMatchObject({ dispatch: false, notify: false })
    // No data run since today's close.
    expect(watchdogDecision({ ...ok, dataAt: '2026-11-23T02:00:00Z' }, NOW).dispatch).toBe(true)
    const lateFile = trackHealth(null, late(), NOW, {}, '2026-11-23T07:00:00Z')
    expect(watchdogDecision(lateFile, NOW)).toMatchObject({ dispatch: true, notify: false })
    const turned = new Date(NOW.getTime() + 12.5 * 3600_000)
    const staleFile = trackHealth(lateFile, late(), turned, {}, '2026-11-23T07:00:00Z')
    expect(watchdogDecision(staleFile, turned).notify).toBe(true)
    // Hours later, not 09:00: quiet.
    const quiet = new Date(NOW.getTime() + 15 * 3600_000)
    expect(watchdogDecision(trackHealth(staleFile, late(), quiet, {}, '2026-11-23T07:00:00Z'), quiet).notify).toBe(false)
  })
})
