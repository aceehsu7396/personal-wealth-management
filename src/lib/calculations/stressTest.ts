import type { Holding } from '../storage/schema'
import { holdingValueTwd } from './portfolioRisk'

// Stress tests (blueprint 02 §5.2): historical and hypothetical shocks
// applied to today's holdings, and the reverse question of how far the
// market can fall before the circuit breaker or the drawdown limit.

// Percent moves. fx is the change in USD/TWD: negative means the NT dollar
// strengthens and US assets lose value in TWD. semis, when set, replaces
// the index move for semiconductor holdings.
export interface Shock {
  tw: number
  us: number
  bond: number
  fx: number
  semis?: number
}

export interface StressScenario extends Shock {
  id: string
  label: string
  period: string
  kind: 'historical' | 'hypothetical' | 'custom'
  source?: string
}

export const HYPOTHETICAL: StressScenario[] = [
  { id: 'tw20', label: '台股下跌 20%', period: '假設', kind: 'hypothetical', tw: -20, us: 0, bond: 0, fx: 0 },
  { id: 'us20', label: '美股下跌 20%', period: '假設', kind: 'hypothetical', tw: 0, us: -20, bond: 0, fx: 0 },
  { id: 'semis40', label: '半導體下跌 40%', period: '假設', kind: 'hypothetical', tw: 0, us: 0, bond: 0, fx: 0, semis: -40 },
  { id: 'twd10', label: '新台幣升值 10%', period: '假設', kind: 'hypothetical', tw: 0, us: 0, bond: 0, fx: -10 },
  { id: 'rates', label: '利率上升（長債 −15%）', period: '假設', kind: 'hypothetical', tw: 0, us: 0, bond: -15, fx: 0 },
]

export type ExposureKind = 'tw_equity' | 'us_equity' | 'bond' | 'cash'

export interface Exposure {
  id: string
  label: string
  valueTwd: number
  kind: ExposureKind
  usd: boolean
  beta: number
  semis: boolean
}

export function exposureKind(h: Holding): ExposureKind {
  if (h.fundType === 'money_market') return 'cash'
  if (h.fundType === 'bond' || h.sleeve === 'core_bond_cash') return 'bond'
  if (h.sleeve === 'core_global' || h.sleeve === 'satellite_us') return 'us_equity'
  if (h.sleeve === 'satellite_fund') return h.currency === 'USD' ? 'us_equity' : 'tw_equity'
  return 'tw_equity'
}

export function exposuresOf(holdings: Holding[], fxUsdTwd: number, betas: Record<string, number | null | undefined>, isSemis: (h: Holding) => boolean): Exposure[] {
  return holdings
    .map((h) => {
      const kind = exposureKind(h)
      const equity = kind === 'tw_equity' || kind === 'us_equity'
      return {
        id: h.id,
        label: `${h.ticker} ${h.name}`.trim(),
        valueTwd: holdingValueTwd(h, fxUsdTwd),
        kind,
        usd: h.currency === 'USD',
        beta: equity ? (betas[h.id] ?? 1) : 1,
        semis: equity && isSemis(h),
      }
    })
    .filter((e) => e.valueTwd > 0)
}

// Price move of one exposure, in % of its value, before currency.
function moveOf(e: Exposure, s: Shock): number {
  if (e.kind === 'cash') return 0
  if (e.kind === 'bond') return s.bond
  if (e.semis && s.semis !== undefined) return s.semis
  return (e.kind === 'tw_equity' ? s.tw : s.us) * e.beta
}

export interface StressResult {
  lossTwd: number
  lossPercent: number
  worst: { label: string; lossTwd: number }[]
}

export function applyShock(exposures: Exposure[], shock: Shock): StressResult {
  const total = exposures.reduce((a, e) => a + e.valueTwd, 0)
  const rows = exposures.map((e) => {
    const after = e.valueTwd * (1 + Math.max(-100, moveOf(e, shock)) / 100) * (e.usd ? 1 + shock.fx / 100 : 1)
    return { label: e.label, lossTwd: after - e.valueTwd }
  })
  const lossTwd = rows.reduce((a, r) => a + r.lossTwd, 0)
  return {
    lossTwd,
    lossPercent: total > 0 ? (lossTwd / total) * 100 : 0,
    worst: rows.filter((r) => r.lossTwd < 0).sort((a, b) => a.lossTwd - b.lossTwd).slice(0, 5),
  }
}

// The fall in both stock markets (no currency or bond move) that takes the
// portfolio from its current drawdown to the threshold, in %; null when no
// fall of 100% or less gets there.
export function marketFallTo(exposures: Exposure[], currentDrawdownPercent: number, thresholdPercent: number): number | null {
  const total = exposures.reduce((a, e) => a + e.valueTwd, 0)
  const sensitivity = exposures.reduce((a, e) => a + (e.kind === 'tw_equity' || e.kind === 'us_equity' ? e.valueTwd * e.beta : 0), 0) / (total || 1)
  const needed = 1 - (1 - thresholdPercent / 100) / (1 + currentDrawdownPercent / 100)
  if (needed <= 0) return 0
  if (sensitivity <= 0) return null
  const fall = (needed / sensitivity) * 100
  return fall <= 100 ? fall : null
}
