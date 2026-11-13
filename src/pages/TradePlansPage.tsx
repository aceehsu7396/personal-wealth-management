import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useSignals } from '../lib/research/useSignals'
import { evaluateThesis } from '../lib/calculations/thesisScoring'
import { analyzePortfolio } from '../lib/calculations/portfolioRisk'
import { fetchDataset } from '../lib/research/finmind'
import type { PriceRow } from '../lib/research/etfProfile'
import { atr } from '../lib/backtest/indicators'
import { parseSymbol } from '../lib/backtest/templates'
import { useRegime } from '../lib/market/useRegime'
import { annualVolPercent, historyStart } from '../lib/useHoldingReturns'
import { todayIsoDate } from '../lib/market/twse'
import { backtestOf, manualPlan, planFromStrategy, planFromThesis, type PlanDraft } from '../lib/trades/tradePlan'
import { EntryMethodSchema, type TradePlan } from '../lib/storage/schema'
import { PlanEditor } from '../components/trades/PlanEditor'
import { ENTRY_METHOD_LABELS, PLAN_STATUS } from '../components/trades/planLabels'
import { Badge, Card, DataTable, PageHeader, primaryButton, textLink } from '../components/ui'
import { JourneyNotice } from '../components/JourneyNotice'
import { useJourney } from '../lib/useJourney'

const fmt = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 }))
const SOURCE_LABELS: Record<TradePlan['source'], string> = { thesis: '研究卡', strategy: '策略卡', core: '核心', manual: '手動' }

// Last close, 14-day ATR and a year's volatility for a draft's stop and
// size; the year of bars shares its cache with the risk page.
async function lastCloseAndAtr(ticker: string): Promise<{ close?: number; atr?: number; vol?: number }> {
  try {
    const rows = (await fetchDataset<PriceRow>('TaiwanStockPrice', ticker, historyStart(todayIsoDate()))).filter((r) => r.close > 0)
    const bars = rows.map((r) => ({ date: r.date, open: r.open, high: r.max, low: r.min, close: r.close, volume: 0 }))
    const a = atr(bars).at(-1)
    return { close: bars.at(-1)?.close, atr: a && Number.isFinite(a) ? a : undefined, vol: bars.length >= 60 ? annualVolPercent(bars) : undefined }
  } catch {
    return {}
  }
}

function PlanTable({ plans }: { plans: TradePlan[] }) {
  return (
    <DataTable
      rows={plans}
      rowKey={(p) => p.id}
      empty="沒有計畫單。"
      columns={[
        {
          key: 'ticker',
          label: '標的',
          render: (p) => (
            <Link to={`/portfolio/plans?id=${p.id}`} className="font-medium text-gray-900 hover:underline dark:text-gray-100">
              {p.ticker} {p.name}
            </Link>
          ),
          sortValue: (p) => p.ticker,
        },
        { key: 'status', label: '狀態', render: (p) => <Badge tone={PLAN_STATUS[p.status].tone}>{PLAN_STATUS[p.status].label}</Badge> },
        { key: 'source', label: '來源', render: (p) => SOURCE_LABELS[p.source] },
        { key: 'method', label: '進場方法', render: (p) => ENTRY_METHOD_LABELS[p.entryMethod] },
        { key: 'entry', label: '進場價', numeric: true, render: (p) => fmt(p.fillPrice ?? p.entryPrice), sortValue: (p) => p.entryPrice },
        { key: 'stop', label: '停損', numeric: true, render: (p) => fmt(p.currentStop ?? p.stopLoss) },
        { key: 'shares', label: '股數', numeric: true, render: (p) => fmt(p.shares) },
        { key: 'updated', label: '更新', render: (p) => p.updatedAt.slice(0, 10), sortValue: (p) => p.updatedAt },
      ]}
    />
  )
}

// Trade plans (blueprint 02 §3.3): every trading-sleeve trade starts here.
// ?thesis=<id> or ?strategy=<id> drafts one (or reopens the existing draft);
// ?id=<plan> opens one.
export function TradePlansPage() {
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const plans = useAppStore((s) => s.tradePlans)
  const theses = useAppStore((s) => s.stockTheses)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const holdings = useAppStore((s) => s.holdings)
  const policy = useAppStore((s) => s.investmentPolicy)
  const { journey } = useJourney()
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const addTradePlan = useAppStore((s) => s.addTradePlan)
  const runs = useAppStore((s) => s.backtestRuns)
  const signalsFor = useSignals()
  const { ctx: regime, loading: regimeLoading } = useRegime()
  const [creating, setCreating] = useState(false)
  const started = useRef(false)

  const thesisId = search.get('thesis')
  const strategyId = search.get('strategy')
  const tickerParam = search.get('ticker')
  const planId = search.get('id')
  // From an entry-condition signal: the method it suggests.
  const method = EntryMethodSchema.safeParse(search.get('method')).data

  useEffect(() => {
    // Drafts wait for the regime so their size carries its multiplier.
    if (started.current || (!thesisId && !strategyId && !tickerParam) || regimeLoading) return
    started.current = true
    const open = (id: string) => {
      void navigate(`/portfolio/plans?id=${id}`, { replace: true })
    }
    const withMethod = <T extends PlanDraft>(d: T): T => (method ? { ...d, entryMethod: method } : d)
    if (tickerParam && !thesisId && !strategyId) {
      const market = search.get('market') === 'US' ? 'US' : 'TW'
      open(addTradePlan(withMethod({ ...manualPlan(policy), ticker: tickerParam, market })))
      return
    }
    const existing = plans.find((p) => p.status === 'draft' && ((thesisId && p.thesisId === thesisId) || (strategyId && p.strategyId === strategyId)))
    if (existing) {
      open(existing.id)
      return
    }
    if (thesisId) {
      const thesis = theses.find((t) => t.id === thesisId)
      if (!thesis) {
        setSearch({}, { replace: true })
        return
      }
      const report = signalsFor(thesis, evaluateThesis(thesis, policy))
      const total = analyzePortfolio(holdings, theses, policy, guardrails, meta).totalValueTwd
      setCreating(true)
      void (thesis.market === 'TW' ? lastCloseAndAtr(thesis.ticker) : Promise.resolve({ vol: undefined })).then((q) => {
        open(addTradePlan(withMethod(planFromThesis(thesis, report, policy, regime, { annualVolPercent: q.vol, totalValueTwd: total }))))
      })
      return
    }
    const strategy = strategies.find((s) => s.id === strategyId)
    if (!strategy) {
      setSearch({}, { replace: true })
      return
    }
    setCreating(true)
    const { market, code } = parseSymbol(strategy.symbols[0] ?? '')
    const total = analyzePortfolio(holdings, theses, policy, guardrails, meta).totalValueTwd
    void (market === 'TW' && code ? lastCloseAndAtr(code) : Promise.resolve({} as { close?: number; atr?: number; vol?: number })).then((quote) => {
      const draft: PlanDraft = planFromStrategy(strategy, quote, total, policy, regime, { annualVolPercent: quote.vol, backtest: backtestOf(runs, strategy.id) })
      open(addTradePlan(withMethod(draft)))
    })
  }, [thesisId, strategyId, plans, theses, strategies, holdings, policy, guardrails, meta, signalsFor, addTradePlan, navigate, setSearch, regime, regimeLoading, runs, tickerParam, method, search])

  const plan = planId ? plans.find((p) => p.id === planId) : undefined
  const newManual = () => {
    const id = addTradePlan(manualPlan(policy))
    void navigate(`/portfolio/plans?id=${id}`)
  }

  if (plan) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader title="交易計畫單" summary={`下單前寫好為什麼進、錯了在哪裡出、對了怎麼出、買多少、怎麼下單。建立於 ${plan.createdAt.slice(0, 10)}。`} />
        <div className="mt-6">
          <PlanEditor plan={plan} />
        </div>
      </div>
    )
  }

  const drafts = plans.filter((p) => p.status === 'draft')
  const open = plans.filter((p) => p.status === 'open')
  const done = plans.filter((p) => p.status === 'closed' || p.status === 'cancelled')
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="交易計畫"
        summary={creating ? '正在依策略卡與最新價格建立計畫單…' : '交易部位的每一筆都從計畫單開始。從研究卡或策略卡「建立計畫單」，或在這裡手動新增。'}
        action={
          <button type="button" className={primaryButton} onClick={newManual}>
            手動新增計畫單
          </button>
        }
      />
      <JourneyNotice
        missing={journey.missingForSatellite}
        intro="計畫單可以先寫；交易部位的實單要先完成這些步驟，否則交易前檢核會標示未通過："
      />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={`進行中（${open.length}）`} description="已成交、正在持有。停損與停利在「持股與風控」的出場管理追蹤。" action={<Link to="/portfolio" className={textLink}>出場管理</Link>}>
          <PlanTable plans={open} />
        </Card>
        <Card title={`草稿（${drafts.length}）`} description="還沒成交。下單後打開計畫單按「記錄成交」。">
          <PlanTable plans={drafts} />
        </Card>
      </div>
      <Card title={`已結束（${done.length}）`} className="mt-6">
        <PlanTable plans={[...done].sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))} />
      </Card>
    </div>
  )
}
