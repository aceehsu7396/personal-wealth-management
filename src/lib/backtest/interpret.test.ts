import { describe, expect, it } from 'vitest'
import { interpretBacktest, type InterpretInput } from './interpret'
import { STARTER_STRATEGIES } from './starterStrategies'
import { resolveParams, STRATEGY_TEMPLATES } from './templates'
import { TradingStrategySchema, type BacktestStats } from '../storage/schema'

function stats(o: Partial<BacktestStats> = {}): BacktestStats {
  return { totalReturn: 0.5, cagr: 0.1, maxDrawdown: -0.15, sharpe: 1, trades: 40, winRate: 0.5, profitFactor: 1.8, exposure: 0.7, ...o }
}

function input(o: Partial<InterpretInput> = {}): InterpretInput {
  return {
    full: stats(),
    inSample: stats(),
    outOfSample: stats({ cagr: 0.09 }),
    benchmarkFull: stats({ cagr: 0.08, sharpe: 0.8 }),
    benchmarkOutOfSample: stats({ cagr: 0.07 }),
    grid: null,
    maxDrawdownLimitPercent: 30,
    ...o,
  }
}

const titles = (i: InterpretInput) => interpretBacktest(i).map((f) => f.title)

describe('interpretBacktest', () => {
  it('passes a robust result', () => {
    expect(interpretBacktest(input())).toEqual([expect.objectContaining({ level: 'ok', title: '沒有發現明顯問題' })])
  })

  it('flags an out-of-sample loss to buy-and-hold first', () => {
    const f = interpretBacktest(input({ outOfSample: stats({ cagr: 0.05 }) }))
    expect(f[0]).toMatchObject({ level: 'warning', title: '樣本外沒有勝過買進持有（報酬與風險調整後都沒有）' })
  })

  it('credits a lower return bought with a much shallower drawdown', () => {
    const f = interpretBacktest(input({ full: stats({ cagr: 0.07, maxDrawdown: -0.1 }), benchmarkFull: stats({ cagr: 0.08, maxDrawdown: -0.3, sharpe: 0.8 }) }))
    expect(f.map((x) => x.title)).toContain('報酬較低，但每承受一分回撤換到的報酬較多')
  })

  it('notes a pass earned by losing less rather than earning more', () => {
    const f = interpretBacktest(input({ outOfSample: stats({ cagr: 0.05, sharpe: 1.2, maxDrawdown: -0.08 }) }))
    expect(f[0]).toMatchObject({ level: 'caution', title: '以「少賠」通過：報酬低於買進持有' })
  })

  it('flags small samples, decay, drawdown, risk-driven returns, low exposure and thin edge', () => {
    expect(titles(input({ full: stats({ trades: 6 }) }))).toContain('交易只有 6 筆，樣本太少')
    expect(titles(input({ inSample: stats({ cagr: 0.3 }), outOfSample: stats({ cagr: 0.1 }) }))).toContain('樣本外明顯變差，可能過度最佳化')
    expect(titles(input({ full: stats({ maxDrawdown: -0.35 }) }))).toContain('最大回撤超過投資政策上限')
    expect(titles(input({ full: stats({ sharpe: 0.5 }) }))).toContain('多賺的報酬來自多承擔風險')
    expect(titles(input({ full: stats({ exposure: 0.2, cagr: 0.05 }) }))).toContain('大部分時間空手，錯過漲勢')
    expect(titles(input({ full: stats({ profitFactor: 1.1 }) }))).toContain('優勢很薄')
  })

  it('flags fragile parameters from the sensitivity grid', () => {
    const cell = (cagr: number) => ({ a: 0, b: 0, cagr, maxDrawdown: 0, oosCagr: null })
    const grid = { aLabel: '', bLabel: '', aValues: [], bValues: [], cells: [0.01, 0.02, 0.03, 0.02, 0.05, 0.2, 0.01, 0.02, 0.03].map(cell) }
    expect(titles(input({ grid }))).toContain('參數稍微改動，績效差很多')
    const steady = { ...grid, cells: [0.09, 0.1, 0.1, 0.1, 0.1, 0.11, 0.1, 0.1, 0.1].map(cell) }
    expect(titles(input({ grid: steady }))).not.toContain('參數稍微改動，績效差很多')
  })
})

describe('starter strategies', () => {
  it('are valid strategy cards with resolvable parameters', () => {
    for (const s of STARTER_STRATEGIES) {
      const card = { ...s.card, id: s.id, status: 'dev', createdAt: '', updatedAt: '' }
      expect(TradingStrategySchema.safeParse(card).success).toBe(true)
      const def = STRATEGY_TEMPLATES[s.card.template]
      expect(Object.keys(resolveParams(s.card.template, s.card.params)).sort()).toEqual(def.params.map((p) => p.key).sort())
      if (def.backtestable) expect(s.card.symbols.length).toBeGreaterThan(0)
      if (def.multiSymbol) expect(s.card.symbols.length).toBeGreaterThanOrEqual(2)
    }
  })
})
