import type { BacktestStats } from '../storage/schema'

// Roadmap step 4.2 (handbook chapter 10 §6.2): out of sample, a strategy
// passes by earning more than buy-and-hold, or by earning a better
// risk-adjusted return with a clearly smaller drawdown. Timing strategies
// sit in cash part of the time, so in a strong bull market they trail on
// return alone; what they offer is losing less.
export const PASS_RULES = {
  // The strategy's drawdown must be at most this share of buy-and-hold's.
  maxDrawdownRatio: 2 / 3,
} as const

export type PassRoute = 'return' | 'risk'

export interface PassVerdict {
  passed: boolean
  route: PassRoute | null
  reason: string
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const ratio = (v: number | null) => (v === null ? '—' : v.toFixed(2))

export function outOfSampleVerdict(strategy: BacktestStats | null, benchmark: BacktestStats | null): PassVerdict {
  if (!strategy || !benchmark) return { passed: false, route: null, reason: '未設定樣本外，無法判定' }
  if (strategy.cagr > benchmark.cagr) {
    return { passed: true, route: 'return', reason: `樣本外年化 ${pct(strategy.cagr)} 勝過買進持有 ${pct(benchmark.cagr)}` }
  }
  const sharpeOk = strategy.sharpe !== null && benchmark.sharpe !== null && strategy.sharpe >= benchmark.sharpe
  const ddLimit = Math.abs(benchmark.maxDrawdown) * PASS_RULES.maxDrawdownRatio
  const ddOk = Math.abs(strategy.maxDrawdown) <= ddLimit + 1e-9
  const detail = `夏普比率 ${ratio(strategy.sharpe)}（買進持有 ${ratio(benchmark.sharpe)}），最大回撤 ${pct(strategy.maxDrawdown)}（買進持有 ${pct(benchmark.maxDrawdown)}，需 ≤ ${pct(-ddLimit)}）`
  if (strategy.cagr > 0 && sharpeOk && ddOk) {
    return { passed: true, route: 'risk', reason: `風險調整後勝出：${detail}` }
  }
  return {
    passed: false,
    route: null,
    reason: `樣本外年化 ${pct(strategy.cagr)} 未勝過買進持有 ${pct(benchmark.cagr)}，風險調整後也未勝出：${detail}`,
  }
}
