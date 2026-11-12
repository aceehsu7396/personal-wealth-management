import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { useSignals } from '../../lib/research/useSignals'
import { evaluateThesis } from '../../lib/calculations/thesisScoring'
import { analyzePortfolio } from '../../lib/calculations/portfolioRisk'
import { riskLimitOf } from '../../lib/calculations/preTradeChecklist'
import { useChecklistContext } from '../../lib/trades/useChecklistContext'
import { backtestOf, planAdvice, sizeOptions } from '../../lib/trades/tradePlan'
import { useAnnualVol } from '../../lib/useHoldingReturns'
import { tradeLink } from '../../lib/trades/tradeLink'
import { todayIsoDate } from '../../lib/market/twse'
import type { PlanAdvice, TradePlan } from '../../lib/storage/schema'
import { inputClass, labelClass } from '../forms/FormField'
import { AdviceList, Badge, Card, Disclosure, primaryButton, secondaryButton, textLink } from '../ui'
import { ENTRY_METHOD_LABELS, PLAN_STATUS, STOP_METHOD_LABELS, TRAILING_LABELS } from './planLabels'

const fmt = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 }))
const num = (s: string) => (s.trim() === '' ? undefined : Number(s))

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  )
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-gray-100 pt-4 first:border-0 first:pt-0 dark:border-gray-700">
      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {step} {title}
      </legend>
      <div className="mt-2 space-y-3">{children}</div>
    </fieldset>
  )
}

// Follow or decline one piece of advice; a decline asks why.
function Decision({ item, saved, onSave }: { item: PlanAdvice; saved?: PlanAdvice; onSave: (a: PlanAdvice) => void }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState(saved?.reason ?? '')
  if (saved?.decision === 'accepted') return <span className="text-xs text-indigo-700 dark:text-indigo-400">已採納</span>
  if (saved?.decision === 'declined') return <span className="text-xs text-gray-500 dark:text-gray-400">不採納：{saved.reason}</span>
  if (declining) {
    return (
      <span className="flex items-center gap-2">
        <input aria-label="不採納的理由" className="rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="理由" />
        <button type="button" disabled={!reason.trim()} className={textLink} onClick={() => onSave({ ...item, decision: 'declined', reason: reason.trim() })}>
          確定
        </button>
      </span>
    )
  }
  return (
    <span className="flex gap-3">
      <button type="button" className={textLink} onClick={() => onSave({ ...item, decision: 'accepted' })}>
        採納
      </button>
      <button type="button" className="text-sm text-gray-500 hover:underline dark:text-gray-400" onClick={() => setDeclining(true)}>
        不採納
      </button>
    </span>
  )
}

// A trade plan (blueprint 02 §3.3): conclusion and action on the left, the
// seven parts on the right. Advice is recomputed from the rules on every
// change; the trader's follow/decline choices are kept on the plan.
export function PlanEditor({ plan }: { plan: TradePlan }) {
  const update = useAppStore((s) => s.updateTradePlan)
  const theses = useAppStore((s) => s.stockTheses)
  const holdings = useAppStore((s) => s.holdings)
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const runs = useAppStore((s) => s.backtestRuns)
  const ctx = useChecklistContext()
  const signalsFor = useSignals()
  const thesis = plan.thesisId ? theses.find((t) => t.id === plan.thesisId) : undefined
  const report = thesis?.auto ? signalsFor(thesis, evaluateThesis(thesis, ctx.policy)) : null
  const today = todayIsoDate()
  const advice = planAdvice(plan, { ctx, report, thesis, today })
  const draft = plan.status === 'draft'
  const set = (patch: Partial<TradePlan>) => update(plan.id, patch)

  const totalValueTwd = analyzePortfolio(holdings, theses, ctx.policy, guardrails, meta).totalValueTwd
  const strategy = plan.strategyId ? ctx.strategies?.find((s) => s.id === plan.strategyId) : undefined
  const limit = riskLimitOf(strategy, ctx.policy)
  const budget = (((totalValueTwd * ctx.policy.satellitePercent) / 100) * limit.percent) / 100
  const risk = plan.entryPrice && plan.stopLoss && plan.shares ? (plan.entryPrice - plan.stopLoss) * plan.shares : null
  const vol = useAnnualVol(plan.ticker, plan.market)
  const sizing = plan.entryPrice
    ? sizeOptions({ price: plan.entryPrice, stop: plan.stopLoss, totalValueTwd, policy: ctx.policy, strategyRisk: strategy?.riskPerTradePercent, annualVolPercent: vol, backtest: backtestOf(runs, plan.strategyId), multiplier: ctx.regime?.multiplier })
    : null

  const saveDecision = (a: PlanAdvice) => set({ advice: [...plan.advice.filter((x) => x.text !== a.text), a] })
  const savedFor = (a: PlanAdvice) => plan.advice.find((x) => x.text === a.text)

  const buyLink = tradeLink({
    ticker: plan.ticker,
    side: 'buy',
    reason: plan.source === 'strategy' ? 'strategy_entry' : 'tranche_1',
    planId: plan.id,
    thesisId: plan.thesisId,
    strategyId: plan.strategyId,
    shares: plan.shares,
    price: plan.entryPrice,
    stopLoss: plan.stopLoss,
  })
  const sellLink = tradeLink({
    ticker: plan.ticker,
    side: 'sell',
    reason: plan.source === 'strategy' ? 'strategy_exit' : 'exit_overvalued',
    planId: plan.id,
    thesisId: plan.thesisId,
    strategyId: plan.strategyId,
    shares: plan.shares,
  })
  const required = advice.filter((a) => a.level === 'required').length

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-6">
        <Card
          title={`${plan.ticker} ${plan.name}`.trim()}
          action={<Badge tone={PLAN_STATUS[plan.status].tone}>{PLAN_STATUS[plan.status].label}</Badge>}
          description={`${ENTRY_METHOD_LABELS[plan.entryMethod]}・進場 ${fmt(plan.entryPrice)}・停損 ${fmt(plan.currentStop ?? plan.stopLoss)}・${fmt(plan.shares)} 股`}
        >
          {draft && (
            <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
              {required > 0 ? `還有 ${required} 項紀律要求未通過；記錄成交時，交易前檢核會要求寫下例外理由。` : '紀律要求都通過。照計畫下單後，回來記錄成交。'}
            </p>
          )}
          <AdviceList items={advice.map((a) => ({ ...a, text: <>{a.text} <span className="ml-2 inline-block"><Decision item={a} saved={savedFor(a)} onSave={saveDecision} /></span></> }))} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {draft && (
              <Link to={buyLink} className={primaryButton}>
                記錄成交
              </Link>
            )}
            {plan.status === 'open' && (
              <Link to={sellLink} className={primaryButton}>
                記錄出場
              </Link>
            )}
            {draft && (
              <button type="button" className={secondaryButton} onClick={() => set({ status: 'cancelled', closedAt: today })}>
                放棄這張計畫
              </button>
            )}
            <Link to="/portfolio/plans" className={textLink}>
              回到清單
            </Link>
          </div>
          {plan.rules.length > 0 && (
            <Disclosure summary={`依據的規則（${plan.rules.length}）`}>
              <ul className="list-disc space-y-1 pl-5">
                {plan.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Card>
      </div>

      <Card title="計畫單" description="七個欄位在下單前寫好；停損只能往上移。修改會自動儲存。">
        <div className="space-y-5">
          {plan.source === 'manual' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="代號">
                <input className={inputClass} value={plan.ticker} disabled={!draft} onChange={(e) => set({ ticker: e.target.value.trim().toUpperCase() })} />
              </Field>
              <Field label="名稱">
                <input className={inputClass} value={plan.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
            </div>
          )}
          <Section step={1} title="設定：為什麼值得關注">
            <Field label="進場方法">
              <select className={inputClass} value={plan.entryMethod} disabled={!draft} onChange={(e) => set({ entryMethod: e.target.value as TradePlan['entryMethod'] })}>
                {Object.entries(ENTRY_METHOD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="設定">
              <textarea rows={2} className={inputClass} value={plan.setup} onChange={(e) => set({ setup: e.target.value })} />
            </Field>
          </Section>
          <Section step={2} title="觸發：什麼事件發生才進場">
            <Field label="觸發條件">
              <input className={inputClass} value={plan.trigger} onChange={(e) => set({ trigger: e.target.value })} />
            </Field>
          </Section>
          <Section step={3} title="確認：還要哪些條件同時成立">
            <Field label="確認條件">
              <input className={inputClass} value={plan.confirmation} onChange={(e) => set({ confirmation: e.target.value })} />
            </Field>
          </Section>
          <Section step={4} title="失效點：價格到哪裡代表看錯">
            <div className="grid grid-cols-2 gap-3">
              <Field label="初始停損" hint={plan.status !== 'draft' ? `目前停損 ${fmt(plan.currentStop ?? plan.stopLoss)}（只能上移，在出場管理調整）` : undefined}>
                <input type="number" step="0.01" className={inputClass} value={plan.stopLoss ?? ''} disabled={!draft} onChange={(e) => set({ stopLoss: num(e.target.value) })} />
              </Field>
              <Field label="停損方式">
                <select className={inputClass} value={plan.stopMethod} disabled={!draft} onChange={(e) => set({ stopMethod: e.target.value as TradePlan['stopMethod'] })}>
                  {Object.entries(STOP_METHOD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>
          <Section step={5} title="部位：買多少">
            <div className="grid grid-cols-2 gap-3">
              <Field label="計畫進場價">
                <input type="number" step="0.01" className={inputClass} value={plan.entryPrice ?? ''} disabled={!draft} onChange={(e) => set({ entryPrice: num(e.target.value) })} />
              </Field>
              <Field label="股數">
                <input type="number" step="1" className={inputClass} value={plan.shares ?? ''} disabled={!draft} onChange={(e) => set({ shares: num(e.target.value) })} />
              </Field>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {risk === null
                ? '填好進場價、停損與股數後，會算出停損時的虧損。'
                : `停損時虧損約 ${fmt(Math.round(risk))} 元，占每筆上限 ${budget > 0 ? Math.round((risk / budget) * 100) : '—'}%（上限 ${fmt(Math.round(budget))} 元，${limit.source} ${limit.percent}%）。`}
            </p>
            {sizing && (
              <Disclosure summary={`部位大小三法：建議 ${sizing.shares === null ? '—' : `${fmt(sizing.shares)} 股`}`}>
                <ul className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-300">
                  {sizing.options.map((o) => (
                    <li key={o.key}>
                      <span className="font-medium">{o.label}</span>：{o.shares === null ? '—' : `${fmt(o.shares)} 股`}
                      {sizing.chosen === o.key && <span className="ml-1 text-indigo-700 dark:text-indigo-400">（最保守，採用）</span>}
                      <span className="block text-gray-600 dark:text-gray-400">{o.basis}</span>
                    </li>
                  ))}
                  <li className="text-gray-600 dark:text-gray-400">
                    最保守者 × 局勢倍數 {ctx.regime?.multiplier ?? 1}，再受單一部位上限 {fmt(sizing.capShares)} 股限制。
                  </li>
                </ul>
              </Disclosure>
            )}
          </Section>
          <Section step={6} title="委託：怎麼下單">
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field label="委託方式">
                <select className={inputClass} value={plan.orderType} onChange={(e) => set({ orderType: e.target.value as TradePlan['orderType'] })}>
                  <option value="limit">限價</option>
                  <option value="market">市價</option>
                  <option value="stop">觸價</option>
                </select>
              </Field>
              <Field label="下單說明" hint="條件單與觸價單由券商執行；跌停或跳空時可能無法依價成交。">
                <input className={inputClass} value={plan.orderNote} onChange={(e) => set({ orderNote: e.target.value })} />
              </Field>
            </div>
          </Section>
          <Section step={7} title="出場計畫：對了怎麼出、錯了怎麼出">
            <div className="grid grid-cols-2 gap-3">
              <Field label="移動停損">
                <select className={inputClass} value={plan.trailing} onChange={(e) => set({ trailing: e.target.value as TradePlan['trailing'] })}>
                  {Object.entries(TRAILING_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={plan.trailing === 'chandelier' ? 'ATR 倍數' : plan.trailing === 'moving_average' ? '均線天數' : plan.trailing === 'swing_low' ? '前低天數' : '參數'}>
                <input type="number" step="0.5" className={inputClass} value={plan.trailingParam ?? ''} disabled={plan.trailing === 'none'} onChange={(e) => set({ trailingParam: num(e.target.value) })} />
              </Field>
            </div>
            <div>
              <span className={labelClass}>停利點</span>
              <ul className="mt-1 space-y-2">
                {plan.targets.map((t, i) => (
                  <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <input aria-label={`停利點 ${i + 1} 價位`} type="number" step="0.01" className={inputClass} value={t.price} onChange={(e) => set({ targets: plan.targets.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
                    <input aria-label={`停利點 ${i + 1} 出場比例（%）`} type="number" step="1" min="1" max="100" className={inputClass} value={Math.round(t.fraction * 100)} onChange={(e) => set({ targets: plan.targets.map((x, j) => (j === i ? { ...x, fraction: Number(e.target.value) / 100 } : x)) })} />
                    <button type="button" className="text-sm text-gray-500 hover:underline dark:text-gray-400" onClick={() => set({ targets: plan.targets.filter((_, j) => j !== i) })}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className={`${textLink} mt-2`} onClick={() => set({ targets: [...plan.targets, { price: plan.entryPrice ? Math.round(plan.entryPrice * 1.2) : 0, fraction: 0.5 }] })}>
                ＋新增停利點（價位、出場比例 %）
              </button>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field label="時間停損（天）">
                <input type="number" step="1" className={inputClass} value={plan.timeStopDays ?? ''} onChange={(e) => set({ timeStopDays: num(e.target.value) })} />
              </Field>
              <Field label="論點失效時出場">
                <input className={inputClass} value={plan.thesisExit} onChange={(e) => set({ thesisExit: e.target.value })} />
              </Field>
            </div>
          </Section>
        </div>
      </Card>
    </div>
  )
}
