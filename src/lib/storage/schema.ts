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

export const TrendSchema = z.enum(['up', 'flat', 'down'])
export type Trend = z.infer<typeof TrendSchema>

// -1 / 0 / +1 signal. For liquidity, +1 means easing; for sentiment, +1 means
// overheated and -1 means panic.
export const SignalSchema = z.number().int().min(-1).max(1)
export type Signal = z.infer<typeof SignalSchema>

export const MacroCheckInSchema = z.object({
  id: z.string(),
  date: z.string(),
  growth: z.object({
    usPmi: TrendSchema,
    usEmployment: TrendSchema,
    twBusinessSignal: TrendSchema,
    twExportOrders: TrendSchema,
  }),
  inflation: z.object({
    usCpi: TrendSchema,
    twCpi: TrendSchema,
  }),
  liquidity: z.object({
    policyRate: SignalSchema,
    yieldCurve: SignalSchema,
    creditSpread: SignalSchema,
    centralBankBalanceSheet: SignalSchema,
    usDollar: SignalSchema,
  }),
  sentiment: z.object({
    valuation: SignalSchema,
    credit: SignalSchema,
    ipoHype: SignalSchema,
    media: SignalSchema,
    margin: SignalSchema,
    vix: SignalSchema,
  }),
  policyNote: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
})
export type MacroCheckIn = z.infer<typeof MacroCheckInSchema>

export const MarketSchema = z.enum(['TW', 'US'])
export type Market = z.infer<typeof MarketSchema>

export const LynchCategorySchema = z.enum([
  'slow_grower',
  'stalwart',
  'fast_grower',
  'cyclical',
  'turnaround',
  'asset_play',
])
export type LynchCategory = z.infer<typeof LynchCategorySchema>

export const ThesisStatusSchema = z.enum(['watch', 'holding', 'exited'])
export type ThesisStatus = z.infer<typeof ThesisStatusSchema>

const Score1to5 = z.number().min(1).max(5)
const Score0to5 = z.number().min(0).max(5)

export const StockThesisSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  name: z.string(),
  market: MarketSchema,
  sector: z.string(),
  lynchCategory: LynchCategorySchema,
  inCircleOfCompetence: z.boolean(),
  status: ThesisStatusSchema,
  thesis: z.string(),
  drivers: z.string(),
  killCriteria: z.string(),
  sources: z.string(),
  preMortem: z.string(),
  policyRisk: z.string().optional(),
  fiveForces: z.object({
    rivalry: Score1to5,
    newEntrants: Score1to5,
    substitutes: Score1to5,
    buyerPower: Score1to5,
    supplierPower: Score1to5,
  }),
  powers: z.object({
    scaleEconomies: Score0to5,
    networkEconomies: Score0to5,
    counterPositioning: Score0to5,
    switchingCosts: Score0to5,
    branding: Score0to5,
    corneredResource: Score0to5,
    processPower: Score0to5,
  }),
  fScore: z.number().min(0).max(9),
  roicPercent: z.number().optional(),
  waccPercent: z.number().optional(),
  hasUnexplainedRedFlags: z.boolean(),
  fairValueBear: z.number(),
  fairValueBase: z.number(),
  fairValueBull: z.number(),
  currentPrice: z.number(),
  impliedGrowthPercent: z.number().optional(),
  historicalGrowthPercent: z.number().optional(),
  marginOfSafetyOverridePercent: z.number().optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
})
export type StockThesis = z.infer<typeof StockThesisSchema>

export const SleeveSchema = z.enum([
  'core_tw',
  'core_global',
  'core_bond_cash',
  'satellite_tw',
  'satellite_us',
])
export type Sleeve = z.infer<typeof SleeveSchema>

export const CurrencySchema = z.enum(['TWD', 'USD'])
export type HoldingCurrency = z.infer<typeof CurrencySchema>

export const HoldingSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  name: z.string(),
  sleeve: SleeveSchema,
  currency: CurrencySchema,
  shares: z.number(),
  avgCost: z.number(),
  currentPrice: z.number(),
  sector: z.string().optional(),
  thesisId: z.string().optional(),
  priceUpdatedAt: z.string().optional(),
  createdAt: z.string(),
})
export type Holding = z.infer<typeof HoldingSchema>

export const PortfolioMetaSchema = z.object({
  fxUsdTwd: z.number(),
  peakValueTwd: z.number(),
  peakDate: z.string().nullable(),
})
export type PortfolioMeta = z.infer<typeof PortfolioMetaSchema>

export const TradeSideSchema = z.enum(['buy', 'sell'])
export type TradeSide = z.infer<typeof TradeSideSchema>

export const TradeReasonSchema = z.enum([
  'core_dca',
  'rebalance',
  'tranche_1',
  'tranche_2',
  'tranche_3',
  'exit_thesis_broken',
  'exit_overvalued',
  'exit_opportunity_cost',
  'exit_deep_drawdown_review',
  'exit_over_limit',
])
export type TradeReason = z.infer<typeof TradeReasonSchema>

export const ChecklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  passed: z.boolean(),
})
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>

export const TradeReviewSchema = z.object({
  reviewedAt: z.string(),
  outcomeNote: z.string(),
  decisionQuality: z.number().int().min(1).max(5),
  lesson: z.string(),
})
export type TradeReview = z.infer<typeof TradeReviewSchema>

export const TradeSchema = z.object({
  id: z.string(),
  date: z.string(),
  ticker: z.string(),
  name: z.string(),
  holdingId: z.string().optional(),
  thesisId: z.string().optional(),
  side: TradeSideSchema,
  reason: TradeReasonSchema,
  shares: z.number(),
  price: z.number(),
  currency: CurrencySchema,
  checklist: z.array(ChecklistItemSchema),
  exceptionReason: z.string().optional(),
  emotion: z.number().int().min(1).max(5),
  biasNotes: z.string(),
  review6m: TradeReviewSchema.optional(),
  review12m: TradeReviewSchema.optional(),
  createdAt: z.string(),
})
export type Trade = z.infer<typeof TradeSchema>

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
  macroCheckIns: z.array(MacroCheckInSchema).default([]),
  stockTheses: z.array(StockThesisSchema).default([]),
  holdings: z.array(HoldingSchema).default([]),
  portfolioMeta: PortfolioMetaSchema.default({ fxUsdTwd: 32, peakValueTwd: 0, peakDate: null }),
  trades: z.array(TradeSchema).default([]),
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
    macroCheckIns: [],
    stockTheses: [],
    holdings: [],
    portfolioMeta: { fxUsdTwd: 32, peakValueTwd: 0, peakDate: null },
    trades: [],
  }
}
