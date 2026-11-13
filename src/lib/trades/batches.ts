import type { AddOnRule, PlanAdvice, TradePlan } from '../storage/schema'

// Batches and add-ons (handbook 08 §2.3): each planned buy with its
// price and shares, filled in turn. Before the next one, the whole trade's
// stop risk must stay within the per-trade limit, the regime must allow it,
// and the position must stay under the single-position cap.

export type Batch = TradePlan['batches'][number]

const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const advice = (level: PlanAdvice['level'], text: string, basis: string): PlanAdvice => ({ level, text, basis })

// The research card's three batch prices, each with the card's per-batch
// size (already scaled by the regime multiplier).
export function draftBatches(levels: { key: string; price: number }[], sharesPerBatch: number | undefined, at: string): Batch[] {
  if (!sharesPerBatch || sharesPerBatch <= 0) return []
  return (['batch1', 'batch2', 'batch3'] as const)
    .map((k) => levels.find((l) => l.key === k)?.price)
    .filter((p): p is number => typeof p === 'number' && p > 0)
    .map((price) => ({ kind: 'batch' as const, price: Math.round(price * 100) / 100, shares: sharesPerBatch, addedAt: at }))
}

// Shares bought so far and their average cost.
export function filledPosition(batches: Batch[]): { shares: number; avg: number | null } {
  const filled = batches.filter((b) => b.filledAt)
  const shares = filled.reduce((a, b) => a + (b.fillShares ?? b.shares), 0)
  const cost = filled.reduce((a, b) => a + (b.fillShares ?? b.shares) * (b.fillPrice ?? b.price), 0)
  return { shares, avg: shares > 0 ? cost / shares : null }
}

export const nextBatch = (batches: Batch[]) => batches.findIndex((b) => !b.filledAt)

// Record a buy against the plan's next batch: the plan's shares and fill
// price become the filled total and average.
export function applyFill(plan: Pick<TradePlan, 'batches' | 'shares' | 'fillPrice'>, price: number, shares: number, date: string): Pick<TradePlan, 'batches' | 'shares' | 'fillPrice'> {
  const i = nextBatch(plan.batches)
  if (i < 0) {
    // No batch left (or none planned): an unplanned add still updates the totals.
    const prevShares = plan.shares ?? 0
    const prevCost = (plan.fillPrice ?? price) * prevShares
    const total = prevShares + shares
    return { batches: plan.batches, shares: total, fillPrice: Math.round(((prevCost + price * shares) / total) * 100) / 100 }
  }
  const batches = plan.batches.map((b, k) => (k === i ? { ...b, filledAt: date, fillPrice: price, fillShares: shares } : b))
  const pos = filledPosition(batches)
  return { batches, shares: pos.shares, fillPrice: pos.avg === null ? price : Math.round(pos.avg * 100) / 100 }
}

export interface BatchCheckInput {
  plan: Pick<TradePlan, 'batches' | 'currentStop' | 'stopLoss' | 'createdAt' | 'market'>
  // Per-trade stop-risk limit and the single-position cap, in TWD.
  riskBudgetTwd: number
  positionCapTwd: number
  addOn: AddOnRule | null
  regimeLabel?: string
  close?: number | null
  fxUsdTwd: number
}

// Advice for the pending batches, in the plan's three levels.
export function batchChecks(x: BatchCheckInput): PlanAdvice[] {
  const { plan } = x
  const out: PlanAdvice[] = []
  const pending = plan.batches.map((b, i) => ({ b, i })).filter(({ b }) => !b.filledAt)
  if (plan.batches.length < 2 || pending.length === 0) return out
  const fx = plan.market === 'US' ? x.fxUsdTwd : 1
  const stop = plan.currentStop ?? plan.stopLoss
  const filled = filledPosition(plan.batches)
  const allShares = plan.batches.reduce((a, b) => a + (b.filledAt ? (b.fillShares ?? b.shares) : b.shares), 0)
  const allCost = plan.batches.reduce((a, b) => a + (b.filledAt ? (b.fillShares ?? b.shares) * (b.fillPrice ?? b.price) : b.shares * b.price), 0)

  if (stop !== undefined) {
    const risk = (allCost - allShares * stop) * fx
    if (risk > x.riskBudgetTwd) {
      const next = pending[0].b
      const used = filled.avg !== null ? Math.max(0, (filled.avg - stop) * filled.shares * fx) : 0
      const room = next.price > stop ? Math.max(0, Math.floor((x.riskBudgetTwd - used) / ((next.price - stop) * fx))) : 0
      out.push(advice('required', `全部批次成交後停損風險 ${fmt(Math.round(risk))} 元，超過每筆上限 ${fmt(Math.round(x.riskBudgetTwd))} 元：下一批最多 ${fmt(room)} 股`, '投資政策：每筆停損風險上限（含所有批次）'))
    }
  }

  const value = allCost * fx
  if (value > x.positionCapTwd) out.push(advice('required', `全部批次成交後部位 ${fmt(Math.round(value))} 元，超過單一部位上限 ${fmt(Math.round(x.positionCapTwd))} 元`, '投資政策：單一部位上限'))

  const later = pending.filter(({ i }) => i > 0)
  if (x.addOn === 'none' && later.length > 0 && filled.shares > 0) out.push(advice('required', `${x.regimeLabel ?? '目前局勢'}不加碼：第 ${later[0].i + 1} 批先不要買`, '局勢參數：加碼規則'))
  if (x.addOn === 'scheduled') {
    const created = Date.parse(plan.createdAt)
    const unplanned = later.filter(({ b }) => b.kind === 'add' && Date.parse(b.addedAt) - created > 60_000)
    if (unplanned.length > 0) out.push(advice('required', `${x.regimeLabel ?? '目前局勢'}只允許事先寫好的批次：計畫單建立後才新增的加碼不能買`, '局勢參數：加碼規則'))
  }

  const nextAdd = pending.find(({ b }) => b.kind === 'add')
  if (nextAdd && filled.avg !== null) {
    const above = x.close != null && x.close > filled.avg
    const riskFree = stop !== undefined && stop >= filled.avg
    if (!above || !riskFree) out.push(advice('suggest', '加碼前，先等價格高於平均成本、停損上移到成本以上（原始風險歸零）', '進出場規則：只在獲利時加碼'))
  }
  return out
}
