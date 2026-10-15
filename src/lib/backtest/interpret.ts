import type { BacktestStats } from '../storage/schema'
import type { SensitivityGrid } from './engine'

// Plain-language reading of a backtest (handbook chapter 10 §6): what to
// worry about before trusting the result, most serious first.

export type FindingLevel = 'warning' | 'caution' | 'ok'

export interface Finding {
  level: FindingLevel
  title: string
  detail: string
}

export interface InterpretInput {
  full: BacktestStats
  inSample: BacktestStats | null
  outOfSample: BacktestStats | null
  benchmarkFull: BacktestStats
  benchmarkOutOfSample: BacktestStats | null
  grid: SensitivityGrid | null
  maxDrawdownLimitPercent: number
}

export const INTERPRET_RULES = {
  minTrades: 20,
  oosDecay: 0.5,
  // Annual-return spread across the ±25% grid that counts as fragile.
  gridSpread: 0.08,
  lowExposure: 0.3,
  minProfitFactor: 1.2,
} as const

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export function interpretBacktest(input: InterpretInput): Finding[] {
  const { full, inSample, outOfSample, benchmarkFull, benchmarkOutOfSample, grid } = input
  const out: Finding[] = []

  if (outOfSample && benchmarkOutOfSample && outOfSample.cagr <= benchmarkOutOfSample.cagr) {
    out.push({
      level: 'warning',
      title: '樣本外沒有勝過買進持有',
      detail: `樣本外年化 ${pct(outOfSample.cagr)}，買進持有 ${pct(benchmarkOutOfSample.cagr)}。在沒用來調參數的期間輸給「什麼都不做」，目前沒有證據顯示這個策略有優勢。`,
    })
  }

  if (full.trades < INTERPRET_RULES.minTrades && full.trades > 1) {
    out.push({
      level: 'caution',
      title: `交易只有 ${full.trades} 筆，樣本太少`,
      detail: `少於 ${INTERPRET_RULES.minTrades} 筆時，結果很可能是運氣。可以拉長回測期間、增加標的，或在虛擬帳戶多累積幾筆再判斷。`,
    })
  }

  if (inSample && outOfSample && inSample.cagr > 0 && outOfSample.cagr < inSample.cagr * INTERPRET_RULES.oosDecay) {
    out.push({
      level: 'warning',
      title: '樣本外明顯變差，可能過度最佳化',
      detail: `樣本內年化 ${pct(inSample.cagr)}，樣本外只有 ${pct(outOfSample.cagr)}。參數可能只是剛好符合過去；試著用更「普通」的參數（例如整數、常用天數）再回測一次。`,
    })
  }

  if (grid && grid.cells.length >= 4) {
    const values = grid.cells.map((c) => c.cagr)
    const spread = Math.max(...values) - Math.min(...values)
    const center = grid.cells[Math.floor(grid.cells.length / 2)].cagr
    if (spread > Math.max(INTERPRET_RULES.gridSpread, Math.abs(center))) {
      out.push({
        level: 'caution',
        title: '參數稍微改動，績效差很多',
        detail: `參數上下 25% 的年化報酬介於 ${pct(Math.min(...values))}～${pct(Math.max(...values))}。好的策略在相近參數下表現應該差不多；差距大代表結果不穩定。`,
      })
    }
  }

  if (-full.maxDrawdown * 100 > input.maxDrawdownLimitPercent) {
    out.push({
      level: 'warning',
      title: '最大回撤超過投資政策上限',
      detail: `回測最大回撤 ${pct(full.maxDrawdown)}，投資政策上限 −${input.maxDrawdownLimitPercent}%。實單遇到同樣情況時，你很可能撐不住；降低部位或改用風險部位法。`,
    })
  }

  if (full.cagr > benchmarkFull.cagr && full.sharpe !== null && benchmarkFull.sharpe !== null && full.sharpe < benchmarkFull.sharpe) {
    out.push({
      level: 'caution',
      title: '多賺的報酬來自多承擔風險',
      detail: `年化報酬勝過買進持有，但夏普比率較低（${full.sharpe.toFixed(2)} vs ${benchmarkFull.sharpe.toFixed(2)}）。同樣的報酬，用槓桿較低的方式也可能做到。`,
    })
  }

  if (full.exposure < INTERPRET_RULES.lowExposure && full.cagr < benchmarkFull.cagr) {
    out.push({
      level: 'caution',
      title: '大部分時間空手，錯過漲勢',
      detail: `只有 ${pct(full.exposure)} 的時間有持股，報酬也低於買進持有。進場條件可能太嚴，或適合搭配核心 ETF 一起持有（見下方「核心＋交易組合」）。`,
    })
  }

  if (full.profitFactor !== null && full.trades >= 5 && full.profitFactor < INTERPRET_RULES.minProfitFactor) {
    out.push({
      level: 'caution',
      title: '優勢很薄',
      detail: `獲利因子 ${full.profitFactor.toFixed(2)}，低於 ${INTERPRET_RULES.minProfitFactor}。實單的滑價、零股成交與猶豫，很容易把這點優勢吃掉。`,
    })
  }

  if (out.length === 0) {
    out.push({
      level: 'ok',
      title: '沒有發現明顯問題',
      detail: '樣本外勝過買進持有，交易數足夠，回撤在上限內。下一步：建立虛擬帳戶照規則操作 3 個月，確認自己做得到。',
    })
  } else if (!out.some((f) => f.level === 'warning')) {
    out.push({
      level: 'ok',
      title: '主要條件通過',
      detail: '沒有嚴重問題，但上面的提醒值得在虛擬交易時特別留意。',
    })
  }
  return out
}
