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
  // Filled automatically from the monthly Fubon report + gap search: the
  // reason behind each signal (keyed by field path) and the source report.
  reasons: z.record(z.string(), z.string()).optional(),
  reportId: z.string().optional(),
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
  'satellite_fund',
])
export type Sleeve = z.infer<typeof SleeveSchema>

export const CurrencySchema = z.enum(['TWD', 'USD'])
export type HoldingCurrency = z.infer<typeof CurrencySchema>

export const HoldingKindSchema = z.enum(['security', 'fund'])
export type HoldingKind = z.infer<typeof HoldingKindSchema>

export const FundTypeSchema = z.enum(['index_equity', 'active_equity', 'balanced', 'bond', 'money_market'])
export type FundType = z.infer<typeof FundTypeSchema>

// Stocks/ETFs and mutual funds share one shape: for a fund, ticker is the
// fund code, shares are units, avgCost/currentPrice are NAVs and
// priceUpdatedAt is the NAV date.
export const HoldingSchema = z.object({
  id: z.string(),
  // Absent on data saved before funds existed; treated as 'security'.
  kind: HoldingKindSchema.optional(),
  fundType: FundTypeSchema.optional(),
  expenseRatioPercent: z.number().optional(),
  provider: z.string().optional(),
  ticker: z.string(),
  name: z.string(),
  sleeve: SleeveSchema,
  currency: CurrencySchema,
  shares: z.number(),
  avgCost: z.number(),
  currentPrice: z.number(),
  sector: z.string().optional(),
  thesisId: z.string().optional(),
  // Trading-strategy positions are documented by a strategy card instead.
  strategyId: z.string().optional(),
  priceUpdatedAt: z.string().optional(),
  createdAt: z.string(),
})
export type Holding = z.infer<typeof HoldingSchema>

// Month-end style record of total portfolio value (TWD), kept automatically:
// one entry per month, overwritten by the latest value seen that month.
export const PortfolioSnapshotSchema = z.object({
  month: z.string(),
  date: z.string(),
  valueTwd: z.number(),
})
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>

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
  // Trading-strategy trades: entries follow a strategy card with a stop.
  'strategy_entry',
  'strategy_exit',
  'stop_loss',
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
  strategyId: z.string().optional(),
  stopLoss: z.number().optional(),
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

export const SleevePerformanceSchema = z.object({
  sleeve: SleeveSchema,
  startValue: z.number(),
  endValue: z.number(),
  netFlow: z.number(),
})
export type SleevePerformance = z.infer<typeof SleevePerformanceSchema>

// A quarterly snapshot for attribution. Values are TWD; benchmark returns are
// total returns for the period in percent (0050, VT in TWD, bond/cash).
export const PerformanceReviewSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  sleeves: z.array(SleevePerformanceSchema),
  benchmarkReturns: z.object({
    tw: z.number(),
    global: z.number(),
    bondCash: z.number(),
  }),
  note: z.string().optional(),
  createdAt: z.string(),
})
export type PerformanceReview = z.infer<typeof PerformanceReviewSchema>

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
  // Trading-sleeve risk rules: risk per trade as % of the trading budget,
  // open-position limit, and whether strategy entries need a stop.
  riskPerTradePercent: z.number().default(1),
  maxOpenPositions: z.number().default(8),
  requireStopLoss: z.boolean().default(true),
  signedAt: z.string().optional(),
  updatedAt: z.string(),
})
export type InvestmentPolicy = z.infer<typeof InvestmentPolicySchema>

export const FoundationSchema = z.object({
  emergencyFundAmount: z.number(),
  emergencyFundTargetMonths: z.number(),
  // Living-expense buffer required before trading full time (same cash pot).
  livingBufferMonths: z.number().default(24),
})
export type Foundation = z.infer<typeof FoundationSchema>

export const TwseValuationSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  close: z.number().nullable(),
  dividendYield: z.number().nullable(),
  pe: z.number().nullable(),
  pb: z.number().nullable(),
  period: z.string(),
  date: z.string(),
})

// Latest TWSE valuation data for the tickers the user follows.
export const MarketSnapshotSchema = z.object({
  fetchedOn: z.string().nullable(),
  valuations: z.record(z.string(), TwseValuationSchema),
})
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>

export const ResearchKindSchema = z.enum(['market', 'industry', 'stock', 'fund'])
export type ResearchKind = z.infer<typeof ResearchKindSchema>

// A report source. `fetched` documents were read in full (e.g. a PDF);
// `pages` and `citedCount` show where the report actually used them.
export const ResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  kind: z.enum(['search', 'fetched']).optional(),
  pages: z.array(z.number()).optional(),
  citedCount: z.number().optional(),
})
export type ResearchSource = z.infer<typeof ResearchSourceSchema>

// An AI web-research report. `facts` holds the structured extraction (macro
// signal draft or stock facts) and is validated again where it is used.
// The 17 macro check-in signals, as "pillar.field" paths.
export const MacroSignalKeySchema = z.enum([
  'growth.usPmi',
  'growth.usEmployment',
  'growth.twBusinessSignal',
  'growth.twExportOrders',
  'inflation.usCpi',
  'inflation.twCpi',
  'liquidity.policyRate',
  'liquidity.yieldCurve',
  'liquidity.creditSpread',
  'liquidity.centralBankBalanceSheet',
  'liquidity.usDollar',
  'sentiment.valuation',
  'sentiment.credit',
  'sentiment.ipoHype',
  'sentiment.media',
  'sentiment.margin',
  'sentiment.vix',
])
export type MacroSignalKey = z.infer<typeof MacroSignalKeySchema>

// Indices and rates the Fubon outlook forecasts each month.
export const TrackedIndexSchema = z.enum([
  'taiex',
  'sp500',
  'stoxx600',
  'csi300',
  'us10y',
  'tw10y',
  'cn10y',
  'dxy',
  'eurusd',
  'usdjpy',
  'usdcny',
  'usdtwd',
])
export type TrackedIndex = z.infer<typeof TrackedIndexSchema>

export const AllocationViewSchema = z.enum(['positive', 'neutral', 'negative'])
export type AllocationView = z.infer<typeof AllocationViewSchema>

// Structured digest of one monthly Fubon "市場展望" report.
export const FubonOutlookContentSchema = z.object({
  reportTitle: z.string(),
  reportDate: z.string(),
  summary: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      bullets: z.array(z.object({ text: z.string(), page: z.string() })),
    }),
  ),
  allocation: z.array(z.object({ asset: z.string(), view: AllocationViewSchema, note: z.string() })),
  forecasts: z.array(z.object({ index: TrackedIndexSchema, low: z.number(), high: z.number() })),
  actuals: z.array(z.object({ index: TrackedIndexSchema, value: z.number() })),
  coverage: z.array(
    z.object({
      signal: MacroSignalKeySchema,
      status: z.enum(['covered', 'partial', 'missing']),
      note: z.string(),
      page: z.string(),
    }),
  ),
})
export type FubonOutlookContent = z.infer<typeof FubonOutlookContentSchema>

export const FubonOutlookSchema = FubonOutlookContentSchema.extend({
  id: z.string(),
  pdfUrl: z.string(),
  createdAt: z.string(),
  markdown: z.string(),
  sources: z.array(ResearchSourceSchema),
  estimatedCostUsd: z.number(),
})
export type FubonOutlook = z.infer<typeof FubonOutlookSchema>

export const ResearchReportSchema = z.object({
  id: z.string(),
  kind: ResearchKindSchema,
  subject: z.string(),
  market: z.string(),
  thesisId: z.string().optional(),
  // Market analyses built on a stored Fubon digest record which one.
  fubonOutlookId: z.string().optional(),
  createdAt: z.string(),
  markdown: z.string(),
  sources: z.array(ResearchSourceSchema),
  facts: z.unknown().optional(),
  estimatedCostUsd: z.number(),
})
export type ResearchReport = z.infer<typeof ResearchReportSchema>

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
    riskPerTradePercent: 1,
    maxOpenPositions: 8,
    requireStopLoss: true,
    updatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Trading strategies, backtests and paper trading
// ---------------------------------------------------------------------------

export const StrategyTemplateSchema = z.enum([
  'buy_hold',
  'dca',
  'ma_cross',
  'donchian',
  'rsi_reversion',
  'momentum_rotation',
  'discretionary',
])
export type StrategyTemplate = z.infer<typeof StrategyTemplateSchema>

// dev → paper (virtual trading) → live (real money) → retired.
export const StrategyStatusSchema = z.enum(['dev', 'paper', 'live', 'retired'])
export type StrategyStatus = z.infer<typeof StrategyStatusSchema>

// A strategy card: the written trading plan. Symbols are "TW:0050" or
// "US:SPY" style keys.
export const TradingStrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  template: StrategyTemplateSchema,
  params: z.record(z.string(), z.number()).default({}),
  symbols: z.array(z.string()).default([]),
  edge: z.string().default(''),
  entryRules: z.string().default(''),
  exitRules: z.string().default(''),
  riskPerTradePercent: z.number().default(1),
  status: StrategyStatusSchema,
  notes: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type TradingStrategy = z.infer<typeof TradingStrategySchema>

export const BacktestStatsSchema = z.object({
  totalReturn: z.number(),
  cagr: z.number(),
  maxDrawdown: z.number(),
  sharpe: z.number().nullable(),
  trades: z.number(),
  winRate: z.number().nullable(),
  profitFactor: z.number().nullable(),
  exposure: z.number(),
})
export type BacktestStats = z.infer<typeof BacktestStatsSchema>

const BacktestSplitSchema = z.object({
  full: BacktestStatsSchema,
  inSample: BacktestStatsSchema.nullable(),
  outOfSample: BacktestStatsSchema.nullable(),
})

// A saved backtest: settings, summary statistics and a weekly equity curve.
export const BacktestRunSchema = z.object({
  id: z.string(),
  strategyId: z.string().optional(),
  label: z.string(),
  template: StrategyTemplateSchema,
  params: z.record(z.string(), z.number()),
  symbols: z.array(z.string()),
  start: z.string(),
  end: z.string(),
  initialCapital: z.number(),
  outOfSampleStart: z.string().nullable(),
  dividendAdjusted: z.boolean(),
  stats: BacktestSplitSchema,
  benchmark: BacktestSplitSchema,
  equity: z.array(z.object({ date: z.string(), strategy: z.number(), benchmark: z.number() })),
  createdAt: z.string(),
})
export type BacktestRun = z.infer<typeof BacktestRunSchema>

export const PaperPositionSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  shares: z.number(),
  avgCost: z.number(),
  lastPrice: z.number(),
  lastPriceDate: z.string(),
  stopLoss: z.number().optional(),
  openedAt: z.string(),
})
export type PaperPosition = z.infer<typeof PaperPositionSchema>

export const PaperOrderSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  symbol: z.string(),
  name: z.string(),
  side: TradeSideSchema,
  type: z.enum(['market', 'limit', 'stop']),
  // Limit price, or the trigger price of a stop order.
  price: z.number().optional(),
  shares: z.number(),
  status: z.enum(['open', 'filled', 'cancelled']),
  filledAt: z.string().optional(),
  fillPrice: z.number().optional(),
  fee: z.number().optional(),
  stopLoss: z.number().optional(),
  reason: z.string().default(''),
  emotion: z.number().int().min(1).max(5).optional(),
  // Realized profit of a sell, and in R (risk at entry), when known.
  realizedPnl: z.number().optional(),
  rMultiple: z.number().optional(),
})
export type PaperOrder = z.infer<typeof PaperOrderSchema>

export const PaperAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  strategyId: z.string().optional(),
  market: z.enum(['TW', 'US']),
  initialCash: z.number(),
  cash: z.number(),
  positions: z.array(PaperPositionSchema),
  orders: z.array(PaperOrderSchema),
  equityHistory: z.array(z.object({ date: z.string(), equity: z.number() })),
  createdAt: z.string(),
})
export type PaperAccount = z.infer<typeof PaperAccountSchema>

// A stock or ETF the user is watching, usually added from the screener.
export const WatchItemSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  industry: z.string().default(''),
  priceAtAdd: z.number().nullable(),
  // Which screen (or 手動) put it on the list.
  source: z.string().default(''),
  note: z.string().default(''),
  addedAt: z.string(),
})
export type WatchItem = z.infer<typeof WatchItemSchema>

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
  performanceReviews: z.array(PerformanceReviewSchema).default([]),
  foundation: FoundationSchema.default({ emergencyFundAmount: 0, emergencyFundTargetMonths: 6, livingBufferMonths: 24 }),
  marketSnapshot: MarketSnapshotSchema.default({ fetchedOn: null, valuations: {} }),
  researchReports: z.array(ResearchReportSchema).default([]),
  portfolioSnapshots: z.array(PortfolioSnapshotSchema).default([]),
  fubonOutlooks: z.array(FubonOutlookSchema).default([]),
  tradingStrategies: z.array(TradingStrategySchema).default([]),
  backtestRuns: z.array(BacktestRunSchema).default([]),
  paperAccounts: z.array(PaperAccountSchema).default([]),
  watchlist: z.array(WatchItemSchema).default([]),
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
    performanceReviews: [],
    foundation: { emergencyFundAmount: 0, emergencyFundTargetMonths: 6, livingBufferMonths: 24 },
    marketSnapshot: { fetchedOn: null, valuations: {} },
    researchReports: [],
    portfolioSnapshots: [],
    fubonOutlooks: [],
    tradingStrategies: [],
    backtestRuns: [],
    paperAccounts: [],
    watchlist: [],
  }
}
