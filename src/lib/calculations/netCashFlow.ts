import type { MonthlyRecord } from '../storage/schema'

export interface NetCashFlowResult {
  incomeTotal: number
  expenseTotal: number
  investmentTotal: number
  netCashFlow: number
}

export function computeNetCashFlow(record: MonthlyRecord): NetCashFlowResult {
  const incomeTotal = record.salaryIncome + record.dividendIncome
  const expenseTotal = record.generalExpense + record.householdExpense + record.mortgageExpense
  const investmentTotal = record.investments.reduce((sum, i) => sum + i.amount, 0)
  const netCashFlow = incomeTotal - expenseTotal - investmentTotal
  return { incomeTotal, expenseTotal, investmentTotal, netCashFlow }
}
