import type { WeightedReturns } from './attribution'
import type { CalibrationSummary } from './calibration'
import type { ExecutionStats } from '../trades/tradePlan'
import type { AdviceUptake, RGroup } from '../trades/rStats'

// The yearly review (blueprint 02 §6.4): one report of goal progress,
// returns, plan execution, rule breaks, and judgement quality, ending with
// revision suggestions from fixed rules. Suggestions never change a setting.

export interface AnnualInput {
  year: string
  goal: { readiness: string; netWorth: string; requiredReturn: string }
  returns: WeightedReturns | null
  excessReturn: number | null
  execution: ExecutionStats
  uptake: AdviceUptake
  byMethod: RGroup[]
  exceptions: number
  pauses: number
  circuitBreaker: boolean
  regimeHitRate: number | null
  regimeScored: number
  calibration: CalibrationSummary
  decisions: { total: number; reviewed: number; avgQuality: number | null }
}

export interface AnnualReport {
  sections: { title: string; lines: string[] }[]
  suggestions: string[]
  markdown: string
}

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`)

export const SUGGESTION_RULES = { lateStops: 2, methodMin: 5, mwrGap: 0.02, declinedGapR: 0.5 } as const

export function suggestions(x: AnnualInput): string[] {
  const out: string[] = []
  if (x.execution.lateStops >= SUGGESTION_RULES.lateStops) out.push(`停損延遲 ${x.execution.lateStops} 次：下單後立刻在券商設觸價停損單，不靠盯盤。`)
  for (const g of x.byMethod) {
    if (g.count >= SUGGESTION_RULES.methodMin && g.avgR < 0) out.push(`「${g.key}」${g.count} 筆平均 ${g.avgR.toFixed(2)}R：考慮在局勢參數表暫停這種進場方法，或回到回測重新驗證。`)
  }
  const c = x.calibration
  if (c.brier !== null && c.baseline !== null && c.brier > c.baseline) out.push(`情境的布瑞爾分數 ${c.brier.toFixed(2)} 比平均猜測（${c.baseline.toFixed(2)}）還差：機率給得太有把握，明年單一情境不要超過 70%。`)
  const u = x.uptake
  if (u.followedR !== null && u.declinedR !== null && u.declinedCount > 0 && u.followedR - u.declinedR >= SUGGESTION_RULES.declinedGapR) {
    out.push(`不採納紀律要求的計畫單平均 ${u.declinedR.toFixed(2)}R，採納的 ${u.followedR.toFixed(2)}R：照紀律執行。`)
  }
  const r = x.returns
  if (r?.twrAnnual != null && r.mwrAnnual != null && r.twrAnnual - r.mwrAnnual > SUGGESTION_RULES.mwrGap) {
    out.push(`金額加權報酬比時間加權低 ${pct(r.twrAnnual - r.mwrAnnual)}：加碼的時機不好，檢討是否在高點投入、低點停扣。`)
  }
  if (x.pauses > 0) out.push(`今年觸發暫停 ${x.pauses} 次：回顧暫停檢討的共同原因，必要時調低每筆風險。`)
  if (out.length === 0) out.push('沒有規則觸發的修訂建議；投資政策與局勢參數可以維持。')
  return out
}

export function annualReport(x: AnnualInput): AnnualReport {
  const u = x.uptake
  const rate = (l: keyof AdviceUptake['byLevel']) => (u.byLevel[l].decided ? pct(u.byLevel[l].accepted / u.byLevel[l].decided, 0) : '—')
  const sections = [
    { title: '1 目標進度', lines: [`全職準備度：${x.goal.readiness}`, `淨資產：${x.goal.netWorth}`, `所需報酬：${x.goal.requiredReturn}`] },
    {
      title: '2 報酬',
      lines: x.returns
        ? [`期間：${x.returns.from} 至 ${x.returns.to}`, `時間加權：${pct(x.returns.twr)}（年化 ${pct(x.returns.twrAnnual)}）`, `金額加權（年化）：${pct(x.returns.mwrAnnual)}`, `相對基準的超額報酬：${pct(x.excessReturn)}`]
        : ['今年還沒有季度績效檢討，先到「績效歸因」記錄。'],
    },
    {
      title: '3 計畫執行',
      lines: [
        `交易部位買進 ${x.execution.satelliteBuys} 筆，有計畫單 ${x.execution.planned} 筆`,
        `平均滑價：${pct(x.execution.avgSlippage, 2)}；停損延遲 ${x.execution.lateStops} 次`,
        `建議採納率：紀律要求 ${rate('required')}、建議 ${rate('suggest')}、提醒 ${rate('notice')}`,
        `平均 R：照紀律 ${u.followedR === null ? '—' : u.followedR.toFixed(2)}（${u.followedCount} 筆）；有不採納 ${u.declinedR === null ? '—' : u.declinedR.toFixed(2)}（${u.declinedCount} 筆）`,
      ],
    },
    { title: '4 違規與暫停', lines: [`例外交易 ${x.exceptions} 筆`, `暫停規則觸發並檢討 ${x.pauses} 次`, `回撤熔斷：${x.circuitBreaker ? '目前觸發中' : '未觸發'}`] },
    {
      title: '5 判斷品質',
      lines: [
        `局勢判斷命中率：${pct(x.regimeHitRate, 0)}（計分 ${x.regimeScored} 段）`,
        `情境：${x.calibration.resolved} 組到期，布瑞爾分數 ${x.calibration.brier === null ? '—' : x.calibration.brier.toFixed(2)}（平均猜測 ${x.calibration.baseline === null ? '—' : x.calibration.baseline.toFixed(2)}，越低越好）`,
        `決策日誌：${x.decisions.total} 筆，已回填 ${x.decisions.reviewed} 筆，平均評分 ${x.decisions.avgQuality === null ? '—' : x.decisions.avgQuality.toFixed(1)}／5`,
      ],
    },
  ]
  const list = suggestions(x)
  const markdown = [
    `# ${x.year} 年度檢討報告`,
    '',
    ...sections.flatMap((s) => [`## ${s.title}`, '', ...s.lines.map((l) => `- ${l}`), '']),
    '## 6 修訂建議（只是建議，修改要在冷靜時簽署）',
    '',
    ...list.map((l) => `- ${l}`),
    '',
  ].join('\n')
  return { sections, suggestions: list, markdown }
}
