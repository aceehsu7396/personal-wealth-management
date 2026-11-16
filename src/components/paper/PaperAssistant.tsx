import { useState } from 'react'
import type { AssistantItem, InvestmentPolicy, PaperAccount, TradingStrategy } from '../../lib/storage/schema'
import type { RegimeContext } from '../../lib/market/regime'
import { ASSISTANT_KIND_LABELS, OUTCOME_LABELS, blocked, executionOf, orderChecks, weeklyReview, type OrderCheck } from '../../lib/paper/assistant'
import { coachPrompt } from '../../lib/ai/prompts/agents'
import { PromptPanel } from '../ai/PromptPanel'
import { formatSymbol } from '../../lib/backtest/templates'
import { ADVICE_LABELS, Badge, Disclosure, type Tone } from '../ui'
import { inputClass } from '../forms/FormField'

const linkClass = 'text-xs font-medium text-indigo-700 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline dark:text-indigo-400'
const mutedClass = 'text-xs text-gray-500 dark:text-gray-400'

const KIND_TONE: Record<AssistantItem['kind'], Tone> = {
  enter: 'good',
  exit: 'warn',
  stop_hit: 'bad',
  raise_stop: 'good',
  near_stop: 'warn',
  hold: 'info',
  wait: 'info',
  no_data: 'info',
}

const ACTION_KINDS: AssistantItem['kind'][] = ['stop_hit', 'exit', 'raise_stop', 'near_stop', 'enter']

const CHECK_CLASS: Record<OrderCheck['level'], string> = {
  required: 'text-red-700 dark:text-red-400',
  suggest: 'text-amber-700 dark:text-amber-400',
  notice: 'text-gray-600 dark:text-gray-400',
}

export function OrderCheckList({ checks }: { checks: OrderCheck[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {checks.map((c) => (
        <li key={c.text} className={c.passed ? 'text-gray-600 dark:text-gray-400' : CHECK_CLASS[c.level]}>
          {c.passed ? '✓' : '✗'} {ADVICE_LABELS[c.level]}：{c.text}
        </li>
      ))}
    </ul>
  )
}

interface Ctx {
  account: PaperAccount
  strategy: TradingStrategy
  backtestPassed: boolean
  regime: RegimeContext | null
  policy: InvestmentPolicy
  today: string
  busy: boolean
  onOrder: (item: AssistantItem, shares: number, stopLoss: number | undefined) => void
  onRaise: (item: AssistantItem) => void
  onSkip: (item: AssistantItem, note: string) => void
}

function ActionRow({ item, ctx }: { item: AssistantItem; ctx: Ctx }) {
  const [shares, setShares] = useState(String(item.shares ?? ''))
  const [stop, setStop] = useState(String(item.stopLoss ?? ''))
  const [skipping, setSkipping] = useState(false)
  const [note, setNote] = useState('')
  const pending = item.outcome === 'pending'
  const order = item.kind === 'enter' || item.kind === 'exit'
  const checks = order
    ? orderChecks({
        side: item.side ?? 'buy',
        price: item.close,
        shares: Number(shares) || 0,
        stopLoss: Number(stop) > 0 ? Number(stop) : undefined,
        date: item.date,
        today: ctx.today,
        account: ctx.account,
        policy: ctx.policy,
        strategy: ctx.strategy,
        backtestPassed: ctx.backtestPassed,
        regime: ctx.regime,
      })
    : []
  const canAct = item.kind === 'enter' || item.kind === 'exit' || item.kind === 'raise_stop'

  return (
    <li className="border-b border-gray-100 py-3 last:border-0 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={KIND_TONE[item.kind]}>{ASSISTANT_KIND_LABELS[item.kind]}</Badge>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatSymbol(item.symbol)}</span>
        <span className="text-sm text-gray-700 dark:text-gray-300">{item.reading}</span>
        <span className={mutedClass}>
          {item.date} 收盤 {item.close}
        </span>
        {!pending && (
          <Badge tone={item.outcome === 'followed' ? 'good' : item.outcome === 'modified' ? 'info' : 'warn'}>
            {OUTCOME_LABELS[item.outcome]}
            {item.note ? `：${item.note}` : ''}
          </Badge>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {item.basis.map((b) => (
          <li key={b} className={mutedClass}>
            {b}
          </li>
        ))}
      </ul>
      {pending && canAct && (
        <div className="mt-2">
          {item.kind === 'enter' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                股數
                <input type="number" step="1" className={`${inputClass} w-28`} value={shares} onChange={(e) => setShares(e.target.value)} />
              </label>
              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                停損
                <input type="number" step="any" className={`${inputClass} w-28`} value={stop} onChange={(e) => setStop(e.target.value)} />
              </label>
            </div>
          )}
          {order && <OrderCheckList checks={checks} />}
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className={linkClass}
              disabled={ctx.busy || (order && blocked(checks))}
              onClick={() => (item.kind === 'raise_stop' ? ctx.onRaise(item) : ctx.onOrder(item, Number(shares) || item.shares || 0, Number(stop) > 0 ? Number(stop) : undefined))}
            >
              {item.kind === 'raise_stop' ? `套用停損 ${item.raiseTo}` : item.kind === 'exit' ? `依建議賣出 ${item.shares} 股` : '依建議下單'}
            </button>
            {skipping ? (
              <span className="flex flex-wrap items-center gap-2">
                <input className={`${inputClass} w-56`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="為什麼不照做？（每週檢討用）" />
                <button type="button" className={linkClass} disabled={note.trim() === ''} onClick={() => ctx.onSkip(item, note.trim())}>
                  確認略過
                </button>
                <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => setSkipping(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => setSkipping(true)}>
                略過
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

// Today's suggestions for a paper account linked to a strategy card
// (handbook 10 §7): what to do, why, and what was done.
export function PaperAssistant(ctx: Ctx) {
  const { account, strategy, backtestPassed, regime } = ctx
  const snap = account.assistant
  const items = snap?.items ?? []
  const actions = items.filter((i) => ACTION_KINDS.includes(i.kind)).sort((a, b) => ACTION_KINDS.indexOf(a.kind) - ACTION_KINDS.indexOf(b.kind))
  const holds = items.filter((i) => i.kind === 'hold')
  const waits = items.filter((i) => i.kind === 'wait' || i.kind === 'no_data')
  const ex = executionOf(account)
  const week = weeklyReview(account, ctx.today)

  return (
    <div className="mt-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">進出場助手</h3>
        <span className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Badge tone={backtestPassed ? 'good' : 'warn'}>{backtestPassed ? '回測已通過' : '回測未通過'}</Badge>
          {regime ? `局勢「${regime.label}」・部位倍數 ${regime.multiplier}` : '局勢資料未載入（部位倍數以 1 計）'}
          {snap && `・資料日期 ${snap.date}`}
        </span>
      </div>
      {!backtestPassed && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">「{strategy.name}」還沒有通過回測：可以照練，但這個帳戶的結果不能用來解鎖實單。</p>}

      {!snap ? (
        <p className={`mt-3 ${mutedClass}`}>收盤後先更新價格，再按「產生今日建議」：助手會依策略卡規則逐檔判斷，並以每筆風險計算股數、設好停損。</p>
      ) : (
        <>
          {actions.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">今天沒有要處理的事：照規則什麼都不做也是一種紀律。</p>
          ) : (
            <ul className="mt-2">
              {actions.map((i) => (
                <ActionRow key={`${i.kind}${i.symbol}${snap.generatedAt}`} item={i} ctx={ctx} />
              ))}
            </ul>
          )}
          {(holds.length > 0 || waits.length > 0) && (
            <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 dark:border-gray-700">
              {[...holds, ...waits].map((i) => (
                <li key={`${i.kind}${i.symbol}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <Badge tone="info">{ASSISTANT_KIND_LABELS[i.kind]}</Badge>
                  <span className="text-gray-900 dark:text-gray-100">{formatSymbol(i.symbol)}</span>
                  <span className="text-gray-600 dark:text-gray-300">{i.reading}</span>
                  {i.basis.length > 0 && <span className={mutedClass}>{i.basis.join('；')}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
        訊號執行率 {ex.rate === null ? '—' : `${Math.round(ex.rate * 100)}%`}（照做 {ex.counts.followed}、修改 {ex.counts.modified}、略過 {ex.counts.skipped}、未處理 {ex.counts.missed}
        {ex.counts.pending > 0 && `、待處理 ${ex.counts.pending}`}）・每週檢討時看略過與修改的理由，找出猶豫、提早出場或移動停損的習慣。
        {ex.notes.length > 0 && (
          <Disclosure summary={`略過與修改的理由（${ex.notes.length}）`}>
            <ul className="mt-1 space-y-0.5">
              {ex.notes.slice(0, 20).map((n, i) => (
                <li key={i}>
                  {n.date} {formatSymbol(n.symbol)} {ASSISTANT_KIND_LABELS[n.kind]}・{OUTCOME_LABELS[n.outcome]}
                  {n.note ? `：${n.note}` : ''}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure summary="本週檢討草稿（過去 7 天）">
          <ul className="mt-1 space-y-0.5">
            {week.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-1">依上面的數字補一句：這週最想改的一件事，以及下週怎麼做。</p>
          <div className="mt-2">
            <PromptPanel label="AI 交易教練" build={() => coachPrompt({ groups: [], execution: [`虛擬帳戶「${account.name}」（策略卡「${strategy.name}」）`, ...week], pauses: [] })} />
          </div>
        </Disclosure>
      </div>
    </div>
  )
}
