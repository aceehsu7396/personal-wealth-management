import { z } from 'zod'

export const SCHEMA_VERSION = 1

export const UserProfileSchema = z.object({
  currentAge: z.number(),
  currency: z.string(),
  updatedAt: z.string(),
})
export type UserProfile = z.infer<typeof UserProfileSchema>

export const FireAssumptionsSchema = z.object({
  currentNetWorth: z.number(),
  monthlyIncome: z.number(),
  savingsMode: z.enum(['amount', 'rate']),
  monthlySavingsAmount: z.number().optional(),
  savingsRatePercent: z.number().optional(),
  monthlyExpenses: z.number(),
  targetAnnualExpensesOverride: z.number().optional(),
  expectedAnnualReturnPercent: z.number(),
  expectedInflationPercent: z.number(),
  safeWithdrawalRatePercent: z.number(),
  updatedAt: z.string(),
})
export type FireAssumptions = z.infer<typeof FireAssumptionsSchema>

export const NetWorthCheckInSchema = z.object({
  id: z.string(),
  date: z.string(),
  netWorthAmount: z.number(),
  note: z.string().optional(),
  createdAt: z.string(),
})
export type NetWorthCheckIn = z.infer<typeof NetWorthCheckInSchema>

export const MarketPhaseSchema = z.enum([
  'bull_early',
  'bull_late',
  'bear',
  'recovery',
  'sideways',
  'unsure',
])
export type MarketPhase = z.infer<typeof MarketPhaseSchema>

export const ValuationZoneSchema = z.enum([
  'undervalued',
  'fair',
  'overvalued',
  'extremely_overvalued',
  'unsure',
])
export type ValuationZone = z.infer<typeof ValuationZoneSchema>

export const InterestRateLevelSchema = z.enum(['low', 'neutral', 'high', 'unsure'])
export type InterestRateLevel = z.infer<typeof InterestRateLevelSchema>

export const MarketCheckInSchema = z.object({
  id: z.string(),
  date: z.string(),
  marketPhase: MarketPhaseSchema,
  valuationZone: ValuationZoneSchema,
  interestRateLevel: InterestRateLevelSchema,
  note: z.string().optional(),
  createdAt: z.string(),
})
export type MarketCheckIn = z.infer<typeof MarketCheckInSchema>

export const MonthlyLineItemSchema = z.object({
  name: z.string().min(1, '請輸入項目名稱'),
  amount: z.number().nonnegative('金額不可為負數'),
})
export type MonthlyLineItem = z.infer<typeof MonthlyLineItemSchema>

const MonthlyRecordShapeSchema = z.object({
  id: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/, '格式須為 YYYY-MM'),
  income: z.array(MonthlyLineItemSchema).default([]),
  expenses: z.array(MonthlyLineItemSchema).default([]),
  investments: z.array(MonthlyLineItemSchema).default([]),
  note: z.string().optional(),
  createdAt: z.string(),
})

// Records created before income/expenses became free-form lists stored them as
// fixed number fields. Detect that legacy shape and fold it into the current
// one so old localStorage data survives instead of silently losing its values.
function normalizeMonthlyRecordInput(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && 'salaryIncome' in raw) {
    const legacy = raw as {
      id: string
      month: string
      salaryIncome: number
      dividendIncome: number
      generalExpense: number
      householdExpense: number
      mortgageExpense: number
      investments?: MonthlyLineItem[]
      note?: string
      createdAt: string
    }
    return {
      id: legacy.id,
      month: legacy.month,
      income: [
        { name: '薪資收入', amount: legacy.salaryIncome },
        { name: '股息收入', amount: legacy.dividendIncome },
      ],
      expenses: [
        { name: '一般消費', amount: legacy.generalExpense },
        { name: '家庭消費', amount: legacy.householdExpense },
        { name: '房貸', amount: legacy.mortgageExpense },
      ],
      investments: legacy.investments ?? [],
      note: legacy.note,
      createdAt: legacy.createdAt,
    }
  }
  return raw
}

export const MonthlyRecordSchema = z.preprocess(
  normalizeMonthlyRecordInput,
  MonthlyRecordShapeSchema,
)
export type MonthlyRecord = z.infer<typeof MonthlyRecordShapeSchema>

export const AdviceGuardrailsSchema = z.object({
  rebalancingBandPercent: z.number(),
  maxTiltPercent: z.number(),
  minEquityFloorPercent: z.number(),
  reviewCadenceMonths: z.number(),
})
export type AdviceGuardrails = z.infer<typeof AdviceGuardrailsSchema>

export const DailyCloseSchema = z.object({
  date: z.string(),
  close: z.number(),
})
export type DailyClose = z.infer<typeof DailyCloseSchema>

export const MarketPriceHistorySchema = z.object({
  taiex: z.array(DailyCloseSchema),
  tw0050: z.array(DailyCloseSchema),
  lastFetchedDate: z.string().nullable(),
})
export type MarketPriceHistory = z.infer<typeof MarketPriceHistorySchema>

export const InvestmentPolicySchema = z.object({
  targetYears: z.number(),
  coreTwEquityPercent: z.number(),
  coreGlobalEquityPercent: z.number(),
  coreBondCashPercent: z.number(),
  satellitePercent: z.number(),
  maxSinglePositionPercent: z.number(),
  maxHighConvictionPositionPercent: z.number(),
  maxSectorPercentOfSatellite: z.number(),
  maxUsdExposurePercent: z.number(),
  marginOfSafetyPercent: z.number(),
  maxDrawdownTolerancePercent: z.number(),
  drawdownCircuitBreakerPercent: z.number(),
  reviewDrawdownFromCostPercent: z.number(),
  updatedAt: z.string(),
})
export type InvestmentPolicy = z.infer<typeof InvestmentPolicySchema>

export function createDefaultInvestmentPolicy(): InvestmentPolicy {
  return {
    targetYears: 10,
    coreTwEquityPercent: 25,
    coreGlobalEquityPercent: 35,
    coreBondCashPercent: 10,
    satellitePercent: 30,
    maxSinglePositionPercent: 5,
    maxHighConvictionPositionPercent: 8,
    maxSectorPercentOfSatellite: 25,
    maxUsdExposurePercent: 70,
    marginOfSafetyPercent: 25,
    maxDrawdownTolerancePercent: 30,
    drawdownCircuitBreakerPercent: 20,
    reviewDrawdownFromCostPercent: 25,
    updatedAt: new Date().toISOString(),
  }
}

export const AppDataSchema = z.object({
  schemaVersion: z.number(),
  profile: UserProfileSchema,
  assumptions: FireAssumptionsSchema,
  guardrails: AdviceGuardrailsSchema,
  checkIns: z.array(NetWorthCheckInSchema),
  marketCheckIns: z.array(MarketCheckInSchema),
  marketPriceHistory: MarketPriceHistorySchema,
  monthlyRecords: z.array(MonthlyRecordSchema).default([]),
  investmentPolicy: InvestmentPolicySchema.default(createDefaultInvestmentPolicy),
})
export type AppData = z.infer<typeof AppDataSchema>

export function createDefaultAppData(): AppData {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      currentAge: 30,
      currency: 'TWD',
      updatedAt: now,
    },
    assumptions: {
      currentNetWorth: 0,
      monthlyIncome: 0,
      savingsMode: 'rate',
      savingsRatePercent: 20,
      monthlyExpenses: 0,
      expectedAnnualReturnPercent: 6,
      expectedInflationPercent: 2,
      safeWithdrawalRatePercent: 4,
      updatedAt: now,
    },
    guardrails: {
      rebalancingBandPercent: 5,
      maxTiltPercent: 10,
      minEquityFloorPercent: 30,
      reviewCadenceMonths: 3,
    },
    checkIns: [],
    marketCheckIns: [],
    marketPriceHistory: {
      taiex: [],
      tw0050: [],
      lastFetchedDate: null,
    },
    monthlyRecords: [],
    investmentPolicy: createDefaultInvestmentPolicy(),
  }
}
