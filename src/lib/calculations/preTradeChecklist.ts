import type {
  AdviceGuardrails,
  Holding,
  InvestmentPolicy,
  PortfolioMeta,
  Sleeve,
  StockThesis,
  TradeReason,
  TradingStrategy,
  TradeSide,
} from '../storage/schema'
import type { MacroAssessment } from './macroRegime'
import { analyzePortfolio, isSatellite } from './portfolioRisk'
import { evaluateThesis } from './thesisScoring'
import { isFund } from './fundRules'
import { STRATEGY_STATUS_LABELS } from '../backtest/templates'

export interface ChecklistEntry {
  key: string
  label: string
  passed: boolean
  // Manual items cannot be derived from stored data; the user confirms them.
  manual: boolean
}

export interface PendingTrade {
  side: TradeSide
  reason: TradeReason
  ticker: string
  name: string
  sleeve: Sleeve
  currency: Holding['currency']
  shares: number
  price: number
  holdingId?: string
  thesisId?: string
  strategyId?: string
  stopLoss?: number
  biasNotes: string
}

export interface ChecklistContext {
  holdings: Holding[]
  theses: StockThesis[]
  policy: InvestmentPolicy
  guardrails: AdviceGuardrails
  meta: PortfolioMeta
  macro: MacroAssessment | null
  strategies?: TradingStrategy[]
  // Action-roadmap gate for satellite buys; omitted means no gate.
  satelliteGate?: { unlocked: boolean; missingSteps: string[] }
}

export const TRADE_REASON_LABELS: Record<TradeReason, string> = {
  core_dca: '核心定期定額',
  rebalance: '再平衡',
  tranche_1: '建倉第 1 批',
  tranche_2: '建倉第 2 批',
  tranche_3: '建倉第 3 批',
  exit_thesis_broken: '出場規則 ① 論點失效',
  exit_overvalued: '出場規則 ② 估值過高',
  exit_opportunity_cost: '出場規則 ③ 機會成本',
  exit_deep_drawdown_review: '出場規則 ④ 深度回檔複查後出場',
  exit_over_limit: '出場規則 ⑤ 超過上限',
  strategy_entry: '策略進場（依策略卡）',
  strategy_exit: '策略出場（依策略卡）',
  stop_loss: '停損出場',
}

export const BUY_REASONS: TradeReason[] = [
  'core_dca',
  'rebalance',
  'strategy_entry',
  'tranche_1',
  'tranche_2',
  'tranche_3',
]
export const SELL_REASONS: TradeReason[] = [
  'rebalance',
  'strategy_exit',
  'stop_loss',
  'exit_thesis_broken',
  'exit_overvalued',
  'exit_opportunity_cost',
  'exit_deep_drawdown_review',
  'exit_over_limit',
]

// Manual confirmations per reason; keys are stable so stored answers survive.
export const MANUAL_CHECKS: Partial<Record<TradeReason, { key: string; label: string }[]>> = {
  exit_thesis_broken: [
    { key: 'killTriggered', label: '研究卡上事先寫下的失效條件確實已觸發（不是事後修改的條件）' },
  ],
  exit_opportunity_cost: [
    { key: 'betterIdea', label: '替代標的的研究卡完整，且預期年化報酬高出 10 個百分點以上' },
  ],
  exit_deep_drawdown_review: [
    { key: 'thesisRewritten', label: '已在 2 週內重寫論點，結論是論點不再成立' },
  ],
  strategy_exit: [{ key: 'exitRuleTriggered', label: '策略卡事先寫下的出場條件確實已觸發' }],
  stop_loss: [{ key: 'stopHit', label: '價格確實觸及進場時設定的停損價（不是臨時改的價位）' }],
}
const SELL_COMMON_MANUAL = [
  { key: 'notPriceNoise', label: '不是因為單日／單週的價格波動或新聞標題' },
  { key: 'costsConsidered', label: '已考慮稅與交易成本' },
]
// Rule-based exits are price-driven by design; only the cost check applies.
const RULE_EXIT_REASONS: TradeReason[] = ['strategy_exit', 'stop_loss']

// Applies a trade to the holdings list: buys average into the cost basis,
// sells reduce shares (never below zero). A buy without a matching holding
// creates one.
export function applyTradeToHoldings(holdings: Holding[], trade: PendingTrade): Holding[] {
  const existing = trade.holdingId ? holdings.find((h) => h.id === trade.holdingId) : undefined
  if (!existing) {
    if (trade.side === 'sell') return holdings
    return [
      ...holdings,
      {
        id: '__pending__',
        ticker: trade.ticker,
        name: trade.name,
        sleeve: trade.sleeve,
        currency: trade.currency,
        shares: trade.shares,
        avgCost: trade.price,
        currentPrice: trade.price,
        thesisId: trade.thesisId,
        createdAt: '',
      },
    ]
  }
  return holdings.map((h) => {
    if (h.id !== existing.id) return h
    if (trade.side === 'buy') {
      const shares = h.shares + trade.shares
      const avgCost = shares > 0 ? (h.shares * h.avgCost + trade.shares * trade.price) / shares : 0
      return { ...h, shares, avgCost, currentPrice: trade.price }
    }
    return { ...h, shares: Math.max(h.shares - trade.shares, 0), currentPrice: trade.price }
  })
}

function check(key: string, label: string, passed: boolean): ChecklistEntry {
  return { key, label, passed, manual: false }
}

export function buildPreTradeChecklist(
  trade: PendingTrade,
  ctx: ChecklistContext,
  manualAnswers: Record<string, boolean>,
): ChecklistEntry[] {
  const { policy, guardrails, meta } = ctx
  const holding = trade.holdingId ? ctx.holdings.find((h) => h.id === trade.holdingId) : undefined
  const thesisId = holding?.thesisId ?? trade.thesisId
  const thesis = thesisId ? ctx.theses.find((t) => t.id === thesisId) : undefined
  // Evaluate the research card at the trade price, not the last saved price.
  const evaluation = thesis ? evaluateThesis({ ...thesis, currentPrice: trade.price }, policy) : null

  const before = analyzePortfolio(ctx.holdings, ctx.theses, policy, guardrails, meta)
  const afterHoldings = applyTradeToHoldings(ctx.holdings, trade)
  const after = analyzePortfolio(afterHoldings, ctx.theses, policy, guardrails, meta)
  const target = after.holdings.find((v) =>
    holding ? v.holding.id === holding.id : v.holding.id === '__pending__',
  )

  const items: ChecklistEntry[] = []
  const manual = (list: { key: string; label: string }[]) =>
    list.forEach((m) => items.push({ ...m, passed: manualAnswers[m.key] === true, manual: true }))

  if (trade.side === 'buy') {
    // Only USD purchases can push USD exposure up; a TWD buy reduces it, so
    // it should not be blocked when the portfolio is already over the cap.
    if (trade.currency === 'USD') {
      items.push(
        check(
          'usdCap',
          `交易後美元曝險 ${after.usdExposurePercent.toFixed(1)}% ≤ 上限 ${policy.maxUsdExposurePercent}%`,
          after.usdExposurePercent <= policy.maxUsdExposurePercent,
        ),
      )
    }

    if (isSatellite(trade.sleeve)) {
      if (ctx.satelliteGate) {
        items.push(
          check(
            'journeyUnlocked',
            ctx.satelliteGate.unlocked
              ? '已完成起步前置步驟（財務地基、核心配置、總經檢視）'
              : `已完成起步前置步驟（尚缺：${ctx.satelliteGate.missingSteps.join('、')}）`,
            ctx.satelliteGate.unlocked,
          ),
        )
      }
      items.push(
        check(
          'satelliteCap',
          `交易後衛星比重 ${after.satellitePercent.toFixed(1)}% ≤ 上限 ${policy.satellitePercent}%`,
          after.satellitePercent <= policy.satellitePercent,
        ),
        check(
          'circuitBreaker',
          '組合未處於回撤熔斷狀態',
          !before.circuitBreakerActive,
        ),
        check(
          'macro',
          ctx.macro
            ? `總經判斷允許衛星新建倉（目前：${ctx.macro.satelliteNewPositionsAllowed ? '允許' : '暫停'}）`
            : '總經判斷允許衛星新建倉（尚無總經檢視，請先到「研究分析 → 市場」新增）',
          ctx.macro?.satelliteNewPositionsAllowed ?? false,
        ),
      )
      // Active funds skip the individual-stock checks (research card,
      // valuation, single-position and sector caps).
      const fund = holding !== undefined && isFund(holding)
      if (trade.reason === 'strategy_entry') {
        items.push(...strategyChecks(trade, ctx, after.totalValueTwd))
      } else {
        if (!fund) items.push(check('thesisLinked', '已連結研究卡', thesis !== undefined))
        if (evaluation && !fund) {
          for (const c of evaluation.checks) items.push(check(`thesis.${c.key}`, c.label, c.passed))
        }
      }
      const openPositions = after.holdings.filter((v) => isSatellite(v.holding.sleeve) && v.holding.shares > 0).length
      items.push(
        check(
          'openPositions',
          `交易後交易部位持有 ${openPositions} 檔 ≤ 上限 ${policy.maxOpenPositions} 檔`,
          openPositions <= policy.maxOpenPositions,
        ),
      )
      if (target && target.positionCapPercent !== null) {
        items.push(
          check(
            'positionCap',
            `交易後單檔權重 ${target.weightPercent.toFixed(1)}% ≤ 上限 ${target.positionCapPercent}%`,
            target.weightPercent <= target.positionCapPercent,
          ),
        )
      }
      const worstSector = after.sectorExposure[0]
      if (worstSector && !fund) {
        items.push(
          check(
            'sectorCap',
            `交易後最大產業「${worstSector.sector}」占衛星額度 ${worstSector.percentOfSatelliteBudget.toFixed(0)}% ≤ 上限 ${policy.maxSectorPercentOfSatellite}%`,
            worstSector.percentOfSatelliteBudget <= policy.maxSectorPercentOfSatellite,
          ),
        )
      }
      items.push(check('bias', '已回答偏誤自問', trade.biasNotes.trim().length > 0))
    }
    return items
  }

  // Sells: verify the stated exit rule actually applies.
  if (!holding) {
    items.push(check('holding', '賣出須選擇既有持股', false))
    return items
  }
  const current = before.holdings.find((v) => v.holding.id === holding.id)
  items.push(check('sharesAvailable', `賣出股數 ≤ 持有股數（${holding.shares}）`, trade.shares <= holding.shares))

  switch (trade.reason) {
    case 'rebalance':
      items.push(
        check(
          'rebalanceNeeded',
          '目前確實有配置偏離超出再平衡帶，或衛星超過上限',
          before.violations.some((v) => v.rule === '再平衡'),
        ),
      )
      break
    case 'exit_overvalued':
      items.push(
        check(
          'overvalued',
          '成交價高於研究卡的樂觀合理價',
          evaluation !== null && (evaluation.priceZone === 'trim' || evaluation.priceZone === 'exit_overvalued'),
        ),
      )
      break
    case 'exit_deep_drawdown_review':
      items.push(
        check(
          'deepDrawdown',
          `成交價較成本下跌至少 ${policy.reviewDrawdownFromCostPercent}%`,
          holding.avgCost > 0 && (trade.price / holding.avgCost - 1) * 100 <= -policy.reviewDrawdownFromCostPercent,
        ),
      )
      break
    case 'exit_over_limit':
      items.push(
        check(
          'overLimit',
          '目前權重超過單檔上限',
          current !== undefined &&
            current.positionCapPercent !== null &&
            current.weightPercent > current.positionCapPercent,
        ),
      )
      break
    default:
      break
  }
  manual(MANUAL_CHECKS[trade.reason] ?? [])
  manual(RULE_EXIT_REASONS.includes(trade.reason) ? SELL_COMMON_MANUAL.slice(1) : SELL_COMMON_MANUAL)
  return items
}

// Risk of one strategy entry: the loss if the stop is hit, as a share of
// the trading budget (total portfolio × trading-sleeve cap).
export function tradeRiskPercent(
  trade: Pick<PendingTrade, 'shares' | 'price' | 'stopLoss' | 'currency'>,
  totalValueTwd: number,
  policy: InvestmentPolicy,
  fxUsdTwd: number,
): number | null {
  if (trade.stopLoss === undefined || trade.stopLoss >= trade.price) return null
  const budget = (totalValueTwd * policy.satellitePercent) / 100
  const fx = trade.currency === 'USD' ? fxUsdTwd : 1
  const risk = trade.shares * (trade.price - trade.stopLoss) * fx
  return budget > 0 ? (risk / budget) * 100 : Infinity
}

function strategyChecks(trade: PendingTrade, ctx: ChecklistContext, totalValueTwd: number): ChecklistEntry[] {
  const { policy } = ctx
  const strategy = trade.strategyId ? ctx.strategies?.find((s) => s.id === trade.strategyId) : undefined
  const items = [
    check('strategyLinked', '已連結策略卡', strategy !== undefined),
    check(
      'strategyLive',
      `策略卡狀態為「實單」${strategy ? `（目前：${STRATEGY_STATUS_LABELS[strategy.status]}）` : ''}`,
      strategy?.status === 'live',
    ),
  ]
  const hasStop = trade.stopLoss !== undefined && trade.stopLoss > 0 && trade.stopLoss < trade.price
  if (policy.requireStopLoss) items.push(check('stopLoss', '已設定低於成交價的停損價', hasStop))
  const risk = tradeRiskPercent(trade, totalValueTwd, policy, ctx.meta.fxUsdTwd)
  if (risk !== null) {
    items.push(
      check(
        'riskPerTrade',
        `本筆停損風險 ${Number.isFinite(risk) ? risk.toFixed(2) : '—'}% 交易部位 ≤ 上限 ${policy.riskPerTradePercent}%`,
        risk <= policy.riskPerTradePercent,
      ),
    )
  }
  return items
}
