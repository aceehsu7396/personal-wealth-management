import { describe, expect, it } from 'vitest'
import type { StockRow } from '../screener/stockData'
import type { StockThesis, StrategyComparison } from '../storage/schema'
import type { AutoResearch } from './autoResearch'
import { applyDailyRun, researchDue, MAX_AUTO_COMPARISONS, mergeRuns, pickDaily, qualifies, runsToImport, type DailyComparison, type DailyRun } from './dailyResearch'
import { blankThesis } from './batchResearch'

const row = (code: string, over: Partial<StockRow> = {}): StockRow => ({
  code,
  name: `名${code}`,
  industry: '半導體業',
  isEtf: false,
  close: 100,
  pe: 10,
  dividendYield: 5,
  pb: 1,
  marketCap: 1000,
  tradeValue: 10,
  revenueYoy: 30,
  revenueYtdYoy: 30,
  revenueMonth: '2026-10',
  ret1m: 0.05,
  ret3m: 0.3,
  ret6m: 0.4,
  ret12m: 0.5,
  ...over,
})

describe('pickDaily', () => {
  const stocks = [row('1101', { marketCap: 3000 }), row('1102', { marketCap: 2000 }), row('1103', { marketCap: 1000 }), row('0050', { isEtf: true, industry: 'ETF' })]

  it('picks one per screen, never the same stock twice in a day', () => {
    const { picks } = pickDaily(stocks, [], '2026-11-20')
    const codes = picks.map((p) => p.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(picks.find((p) => p.screenId === 'etf-momentum')?.code).toBe('0050')
  })

  it('skips stocks researched in the last 30 days', () => {
    const log = [
      { code: '1101', date: '2026-11-01' },
      { code: '1102', date: '2026-10-01' },
    ]
    const { picks } = pickDaily(stocks, log, '2026-11-20')
    expect(picks.map((p) => p.code)).not.toContain('1101')
    expect(picks.map((p) => p.code)).toContain('1102')
  })

  it('adds the active ETF consensus as the last screen', () => {
    const extra = [{ screenId: 'active-consensus', screenName: '主動 ETF 共識', candidates: [row('1101'), row('2330'), row('2454')] }]
    const { picks } = pickDaily(stocks, [{ code: '2330', date: '2026-11-19' }], '2026-11-20', extra)
    const last = picks.at(-1)!
    expect(last.screenId).toBe('active-consensus')
    // 1101 went to an earlier screen today, 2330 was researched yesterday.
    expect(last.code).toBe('2454')
    expect(pickDaily(stocks, [], '2026-11-20', [{ ...extra[0], candidates: [] }]).skipped.at(-1)).toEqual({ screenName: '主動 ETF 共識', reason: '今天沒有符合的標的' })
  })

  it('says why a screen has nothing to pick', () => {
    const { skipped } = pickDaily([row('1101')], [{ code: '1101', date: '2026-11-19' }], '2026-11-20')
    expect(skipped.length).toBeGreaterThan(0)
    expect(skipped.some((s) => s.reason.includes('30 天內'))).toBe(true)
  })
})

describe('mergeRuns', () => {
  const run = (date: string): DailyRun => ({ date, items: [{ screenId: 'value', screenName: '價值', code: date.slice(-2), name: '' }], skipped: [] })

  it('keeps 7 runs and 60 days of log, replacing a rerun of the same day', () => {
    let file = mergeRuns(null, run('2026-09-01'), 'x')
    for (let d = 1; d <= 10; d++) file = mergeRuns(file, run(`2026-11-${String(d).padStart(2, '0')}`), 'x')
    expect(file.runs).toHaveLength(7)
    expect(file.runs[0].date).toBe('2026-11-04')
    expect(file.log.some((l) => l.date === '2026-09-01')).toBe(false)
    file = mergeRuns(file, run('2026-11-10'), 'x')
    expect(file.runs.filter((r) => r.date === '2026-11-10')).toHaveLength(1)
    expect(file.log.filter((l) => l.date === '2026-11-10')).toHaveLength(1)
    expect(runsToImport(file, '2026-11-08').map((r) => r.date)).toEqual(['2026-11-09', '2026-11-10'])
  })
})

describe('researchDue', () => {
  const run = (date: string, marketDate?: string): DailyRun => ({ date, marketDate, items: [], skipped: [] })

  it('skips weekends', () => {
    expect(researchDue('2026-11-21', '2026-11-20', []).due).toBe(false)
    expect(researchDue('2026-11-22', '2026-11-20', []).due).toBe(false)
  })

  it('runs once on the first weekday after a break', () => {
    const runs = [run('2026-11-20', '2026-11-19')]
    // Monday morning: Friday's close is new.
    expect(researchDue('2026-11-23', '2026-11-20', runs).due).toBe(true)
    // A second scheduled run the same day.
    expect(researchDue('2026-11-23', '2026-11-20', [...runs, run('2026-11-23', '2026-11-20')]).due).toBe(false)
  })

  it('skips a weekday holiday, whose data stays on the last trading day', () => {
    const runs = [run('2026-12-24', '2026-12-23')]
    expect(researchDue('2026-12-25', '2026-12-23', runs)).toMatchObject({ due: false })
    expect(researchDue('2026-12-25', '2026-12-23', runs).reason).toContain('已研究過')
  })
})

describe('qualifies', () => {
  it('passes 體質佳 and 留意, not 偏弱', () => {
    expect(qualifies('strong')).toBe(true)
    expect(qualifies('caution')).toBe(true)
    expect(qualifies('weak')).toBe(false)
    expect(qualifies(undefined)).toBe(false)
  })
})

describe('applyDailyRun', () => {
  const auto = (fetchedAt: string) => ({ kind: 'stock', name: '台積電', industry: '半導體業', fetchedAt }) as unknown as AutoResearch
  const comparison = (symbol: string): DailyComparison =>
    ({ symbol, name: '', start: '', end: '', initialCapital: 1, outOfSampleStart: null, round: 0, trials: 1, rows: [], summary: { kind: 'none', headline: '', details: [], ranking: [] }, equity: [] }) as DailyComparison
  const saved = (id: string, symbol: string, createdAt: string, isAuto = false) =>
    ({ ...comparison(symbol), id, createdAt, ...(isAuto ? { auto: { screen: '價值', date: '' } } : {}) }) as StrategyComparison
  let n = 0
  const newId = () => `id${++n}`
  const data = (over: Partial<Parameters<typeof applyDailyRun>[0]>) => ({ stockTheses: [], strategyComparisons: [], tradingStrategies: [], backtestRuns: [], ...over })
  const cards = { library: [], riskPercent: 1 }

  it('adds a new card, refreshes an existing one and keeps its verdict', () => {
    const mine = { ...blankThesis(), ticker: '2330', id: 't1', createdAt: '', updatedAt: '', verdict: 'invest', verdictNote: '我的理由' } as StockThesis
    const run: DailyRun = {
      date: '2026-11-20',
      skipped: [],
      items: [
        { screenId: 'large', screenName: '大型權值', code: '2330', name: '台積電', auto: auto('2026-11-20T00:00:00Z'), rating: 'strong', comparison: comparison('TW:2330') },
        { screenId: 'value', screenName: '價值', code: '2882', name: '國泰金', auto: auto('2026-11-20T00:00:00Z'), rating: 'weak' },
        { screenId: 'growth', screenName: '成長', code: '3008', name: '大立光', error: '額度用完' },
      ],
    }
    const out = applyDailyRun(data({ stockTheses: [mine] }), run, 'now', newId, cards)
    expect(out.stockTheses).toHaveLength(2)
    const updated = out.stockTheses.find((t) => t.id === 't1')!
    expect(updated.verdict).toBe('invest')
    expect(updated.verdictNote).toBe('我的理由')
    expect(updated.auto?.fetchedAt).toBe('2026-11-20T00:00:00Z')
    expect(updated.autoOrigin).toBeUndefined()
    const added = out.stockTheses.find((t) => t.ticker === '2882')!
    expect(added.autoOrigin).toEqual({ screen: '價值', date: '2026-11-20' })
    expect(added.verdict).toBeUndefined()
    expect(out.strategyComparisons).toHaveLength(1)
    expect(out.strategyComparisons[0]).toMatchObject({ symbol: 'TW:2330', thesisId: 't1', auto: { screen: '大型權值', date: '2026-11-20' } })
  })

  it('replaces only the older automatic comparison of the same symbol', () => {
    const before = [saved('own', 'TW:2330', '2026-11-01'), saved('old', 'TW:2330', '2026-11-02', true), saved('other', 'TW:2317', '2026-11-03', true)]
    const run: DailyRun = { date: '2026-11-20', skipped: [], items: [{ screenId: 'large', screenName: '大型權值', code: '2330', name: '', auto: auto('z'), rating: 'strong', comparison: comparison('TW:2330') }] }
    const ids = applyDailyRun(data({ strategyComparisons: before }), run, '2026-11-20', newId, cards).strategyComparisons.map((c) => c.id)
    expect(ids).toContain('own')
    expect(ids).toContain('other')
    expect(ids).not.toContain('old')
    expect(ids).toHaveLength(3)
  })

  it('caps the automatic comparisons without touching yours', () => {
    const before = [
      ...Array.from({ length: 20 }, (_, i) => saved(`own${i}`, 'TW:1', `2026-10-${String(i + 1).padStart(2, '0')}`)),
      ...Array.from({ length: MAX_AUTO_COMPARISONS }, (_, i) => saved(`a${i}`, `TW:${2000 + i}`, `2026-11-01T00:00:${String(i).padStart(2, '0')}`, true)),
    ]
    const run: DailyRun = { date: '2026-11-20', skipped: [], items: [{ screenId: 'value', screenName: '價值', code: '9999', name: '', auto: auto('z'), rating: 'strong', comparison: comparison('TW:9999') }] }
    const list = applyDailyRun(data({ strategyComparisons: before }), run, '2026-11-20', newId, cards).strategyComparisons
    expect(list.filter((c) => !c.auto)).toHaveLength(20)
    expect(list.filter((c) => c.auto)).toHaveLength(MAX_AUTO_COMPARISONS)
    expect(list.some((c) => c.id === 'a0')).toBe(false)
  })

  it('makes a card for each template that passed with 20 or more trades', () => {
    const st = (trades: number) => ({ full: { totalReturn: 0.1, cagr: 0.1, maxDrawdown: -0.1, sharpe: 1, trades, winRate: 0.5, profitFactor: 1.5, exposure: 0.5 }, inSample: null, outOfSample: null })
    const row = (key: string, passed: boolean | null, trades: number, role: 'signal' | 'benchmark' = 'signal') => ({
      entry: { key, label: key, template: 'donchian' as const, params: { entryDays: key.length }, role },
      stats: st(trades),
      passed,
      verdictReason: '樣本外勝過',
      warnings: [],
      costSensitive: false,
      deflatedProbability: null,
      avgR: null,
    })
    const c = { ...comparison('TW:2330'), rows: [row('ok', true, 25), row('few', true, 5), row('fail', false, 40), row('buy_hold', null, 1, 'benchmark')] }
    const run: DailyRun = { date: '2026-11-21', skipped: [], items: [{ screenId: 'large', screenName: '大型權值', code: '2330', name: '台積電', auto: auto('z'), rating: 'strong', comparison: c }] }
    const out = applyDailyRun(data({}), run, 'now', newId, cards)
    expect(out.tradingStrategies.map((s) => s.name)).toEqual(['ok・2330'])
    expect(out.tradingStrategies[0]).toMatchObject({ status: 'dev', symbols: ['TW:2330'] })
    expect(out.tradingStrategies[0].notes).toContain('每日自動研究（大型權值，2026-11-21）')
    expect(out.backtestRuns).toHaveLength(1)
    expect(out.backtestRuns[0]).toMatchObject({ strategyId: out.tradingStrategies[0].id, auto: true, equity: [] })
    // The same card is not made twice.
    const again = applyDailyRun({ ...out, strategyComparisons: [] }, { ...run, date: '2026-11-22' }, 'now', newId, cards)
    expect(again.tradingStrategies).toHaveLength(1)
    expect(again.backtestRuns).toHaveLength(1)
  })
})
