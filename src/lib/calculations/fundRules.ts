import type { FundType, Holding, HoldingCurrency, Sleeve } from '../storage/schema'

export const FUND_TYPE_LABELS: Record<FundType, string> = {
  index_equity: '指數型股票基金',
  active_equity: '主動型股票基金',
  balanced: '平衡型基金',
  bond: '債券型基金',
  money_market: '貨幣型基金',
}

// Expense ratios above these levels get a "fees eat returns" reminder: core
// tools should be cheap; active funds must earn their higher fees.
export const CORE_FUND_MAX_EXPENSE_PERCENT = 1
export const ACTIVE_FUND_MAX_EXPENSE_PERCENT = 2

// A NAV older than this is flagged as stale on the holdings table.
export const FUND_NAV_STALE_DAYS = 7

export function isFund(holding: Pick<Holding, 'kind'>): boolean {
  return holding.kind === 'fund'
}

// Index funds are core (TWD → Taiwan market, otherwise global); bond and
// money-market funds are core bond/cash; active and balanced funds are
// satellite. The user can still change the suggestion.
export function suggestSleeve(fundType: FundType, currency: HoldingCurrency): Sleeve {
  switch (fundType) {
    case 'index_equity':
      return currency === 'TWD' ? 'core_tw' : 'core_global'
    case 'bond':
    case 'money_market':
      return 'core_bond_cash'
    case 'active_equity':
    case 'balanced':
      return 'satellite_fund'
  }
}

export function expenseLimitFor(sleeve: Sleeve): number {
  return sleeve === 'satellite_fund' || sleeve === 'satellite_tw' || sleeve === 'satellite_us'
    ? ACTIVE_FUND_MAX_EXPENSE_PERCENT
    : CORE_FUND_MAX_EXPENSE_PERCENT
}

export function isNavStale(priceUpdatedAt: string | undefined, today: string): boolean {
  if (!priceUpdatedAt) return true
  const days = (Date.parse(today) - Date.parse(priceUpdatedAt)) / 86_400_000
  return days > FUND_NAV_STALE_DAYS
}
