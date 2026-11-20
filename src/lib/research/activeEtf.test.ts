import { describe, expect, it } from 'vitest'
import president from './__fixtures__/active-etf-president.json'
import fuhhwa from './__fixtures__/active-etf-fuhhwa.json'
import thirdParty from './__fixtures__/active-etf-third-party.json'
import {
  changesOf,
  consensus,
  isoDate,
  mergeHistory,
  parseFuhhwa,
  parsePresident,
  parseThirdParty,
  sharesTrend,
  stockActivity,
  topByScale,
  verify,
  type ActiveEtfFile,
  type EtfSnapshot,
  type Holding,
} from './activeEtf'

const snap = (code: string, dataDate: string, holdings: [string, number, number][], scale = 1e10): EtfSnapshot => ({
  code,
  name: code,
  issuer: '統一',
  scale,
  dataDate,
  holdings: holdings.map(([c, shares, weight]): Holding => ({ code: c, name: `名${c}`, shares, weight })),
})

describe('parsing (real responses, trimmed)', () => {
  it('reads the third-party file', () => {
    const { updated, etfs } = parseThirdParty(thirdParty)
    expect(updated).toBe('2026-11-19')
    expect(etfs[0]).toMatchObject({ code: '00981A', issuer: '統一', scale: 232084472007, dataDate: '2026-11-19' })
    expect(etfs[0].holdings[0]).toEqual({ code: '2330', name: '台積電', shares: 19303000, weight: 17.47 })
  })

  it('reads 統一: .NET dates in Taiwan time, stocks only', () => {
    const o = parsePresident(president)
    expect(o.dataDate).toBe('2026-11-19')
    expect(o.scale).toBe(232084472007)
    expect(o.holdings.map((h) => h.code)).toEqual(['2330', '2454', '3017'])
  })

  it('reads 復華: comma and percent strings, no cash rows', () => {
    const o = parseFuhhwa(fuhhwa)
    expect(o.dataDate).toBe('2026-11-19')
    expect(o.scale).toBe(50572956372)
    expect(o.holdings[0]).toEqual({ code: '2330', name: '台灣積體', shares: 4230000, weight: 17.565 })
    expect(o.holdings).toHaveLength(3)
  })

  it('parses the date forms', () => {
    expect(isoDate('2026-11-19T00:00:00')).toBe('2026-11-19')
    expect(isoDate('2026/11/19')).toBe('2026-11-19')
    expect(isoDate('/Date(1795017600000)/')).toBe('2026-11-19')
    expect(isoDate(null)).toBeNull()
  })
})

describe('verify', () => {
  const third = parseThirdParty(thirdParty).etfs[0]

  it('matches the same day', () => {
    expect(verify(third, parsePresident(president))).toMatchObject({ status: 'match', officialDate: '2026-11-19', diffs: [] })
  })

  it('lists different shares and weights beyond rounding', () => {
    const official = parsePresident(president)
    official.holdings[1] = { ...official.holdings[1], shares: 5_000_000 }
    official.holdings[2] = { ...official.holdings[2], weight: 7.4 }
    const check = verify(third, official)
    expect(check.status).toBe('mismatch')
    expect(check.diffs.map((d) => d.code)).toEqual(['2454', '3017'])
    expect(check.diffs[0].official?.shares).toBe(5_000_000)
    // Within 0.05 percentage points is rounding.
    official.holdings[2] = { ...official.holdings[2], weight: 7.5 }
    expect(verify(third, official).diffs.map((d) => d.code)).toEqual(['2454'])
  })

  it('does not compare different days', () => {
    expect(verify(third, { ...parsePresident(president), dataDate: '2026-11-20' }).status).toBe('unverified')
  })
})

describe('ranking and history', () => {
  it('takes the largest Taiwan-equity active ETFs', () => {
    const etfs = [snap('00981A', 'd', [['2330', 1, 90]], 3e11), snap('00406A', 'd', [['2330', 1, 60]], 2e11), snap('00987D', 'd', [['2330', 1, 90]], 9e11), snap('00990A', 'd', [['2330', 1, 10]], 5e11), snap('00403A', 'd', [['2330', 1, 80]], 1e11), snap('00991A', 'd', [['2330', 1, 80]], 5e10)]
    expect(topByScale(etfs).map((e) => e.code)).toEqual(['00981A', '00406A', '00403A'])
  })

  it('keeps one snapshot a day for 60 days', () => {
    let h = mergeHistory(undefined, [snap('A', '2026-09-01', [])])
    h = mergeHistory(h, [snap('A', '2026-11-18', [['2330', 1, 1]])])
    h = mergeHistory(h, [snap('A', '2026-11-18', [['2330', 2, 1]])])
    expect(h.A.map((s) => s.dataDate)).toEqual(['2026-11-18'])
    expect(h.A[0].holdings[0].shares).toBe(2)
  })
})

describe('changes and consensus', () => {
  const file: ActiveEtfFile = {
    generatedAt: '',
    sourceUpdated: '',
    top: ['A', 'B', 'C'],
    ranking: [],
    errors: [],
    history: {
      A: [snap('A', '2026-11-18', [['2330', 100, 10], ['2454', 50, 5], ['1101', 10, 1]]), snap('A', '2026-11-19', [['2330', 120, 11], ['2454', 40, 4], ['2317', 30, 3]])],
      B: [snap('B', '2026-11-18', [['2330', 10, 10], ['2317', 5, 2]]), snap('B', '2026-11-19', [['2330', 12, 10], ['2317', 6, 2], ['2454', 1, 1]])],
      C: [snap('C', '2026-11-18', [['2330', 1, 5], ['2317', 1, 1], ['2454', 1, 1]]), snap('C', '2026-11-19', [['2330', 2, 6], ['2317', 1, 1], ['2454', 1, 1]])],
    },
  }

  it('sorts new, add, cut and removed', () => {
    const c = changesOf(file.history.A[0], file.history.A[1])
    expect(c.map((x) => `${x.code}:${x.kind}:${x.sharesDelta}`)).toEqual(['2317:new:30', '2330:add:20', '2454:cut:-10', '1101:removed:-10'])
    expect(changesOf(undefined, file.history.A[1])).toEqual([])
  })

  it('ranks stocks every fund holds, all adding first', () => {
    const rows = consensus(file)
    expect(rows.map((r) => r.code)).toEqual(['2330', '2317', '2454'])
    expect(rows[0].adding).toBe(3)
    expect(rows[1].adding).toBe(2)
    expect(rows[0].totalWeight).toBe(27)
  })

  it("tells where one stock sits and how its shares moved", () => {
    const a = stockActivity(file, '1101')
    expect(a).toEqual([{ etf: 'A', weight: 0, shares: 0, change: expect.objectContaining({ kind: 'removed' }), dataDate: '2026-11-19' }])
    expect(stockActivity(file, '2330').map((p) => p.etf)).toEqual(['A', 'B', 'C'])
    expect(sharesTrend(file, 'A', '2317')).toEqual([null, 30])
  })
})
