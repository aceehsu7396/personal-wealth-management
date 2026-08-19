import type { MonthlyRecord } from '../storage/schema'

export interface NetCashFlowResult {
  incomeTotal: number
  expenseTotal: number
  investmentTotal: number
  netCashFlow: number
}

function sumAmounts(items: { amount: number }[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

export function computeNetCashFlow(record: MonthlyRecord): NetCashFlowResult {
  const incomeTotal = sumAmounts(record.income)
  const expenseTotal = sumAmounts(record.expenses)
  const investmentTotal = sumAmounts(record.investments)
  const netCashFlow = incomeTotal - expenseTotal - investmentTotal
  return { incomeTotal, expenseTotal, investmentTotal, netCashFlow }
}
