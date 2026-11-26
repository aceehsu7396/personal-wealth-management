import { useState } from 'react'
import type { AssistantItem, InvestmentPolicy, PaperAccount, TradingStrategy } from '../../lib/storage/schema'
import type { RegimeContext } from '../../lib/market/regime'
import { ASSISTANT_KIND_LABELS, NEAR_STOP, OUTCOME_LABELS, adviceSummary, blocked, executionOf, explainItem, orderChecks, priceLevels, weeklyReview, type OrderCheck } from '../../lib/paper/assistant'
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
  // Every paper account: the trading capital (handbook 10 §7).
  accounts?: PaperAccount[]
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

// The card's entry and exit prices for one symbol (handbook 10 §7).
function LevelLines({ levels }: { levels: { entry: string; exit: string } }) {
  return (
    <dl className="mt-1 space-y-0.5 text-sm">
      {(['entry', 'exit'] as const).map((k) => (
        <div key={k} className="flex gap-2">
          <dt className={`shrink-0 ${mutedClass}`}>{k === 'entry' ? '進場價' : '出場價'}</dt>
          <dd className="text-gray-900 tabular-nums dark:text-gray-100">{levels[k]}</dd>
        </div>
      ))}
    </dl>
  )
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
        accounts: ctx.accounts,
      })
    : []
  const canAct = item.kind === 'enter' || item.kind === 'exit' || item.kind === 'raise_stop'
  const ex = explainItem(item, ctx.account, ctx.accounts)
  const lv = priceLevels(item, ctx.account)

  return (
    <li className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
      {/* Conclusion: what to do. */}
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={KIND_TONE[item.kind]}>{ASSISTANT_KIND_LABELS[item.kind]}</Badge>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{ex.action}</span>
        {!pending && (
          <Badge tone={item.outcome === 'followed' ? 'good' : item.outcome === 'modified' ? 'info' : 'warn'}>
            {OUTCOME_LABELS[item.outcome]}
            {item.note ? `：${item.note}` : ''}
          </Badge>
        )}
      </div>
      {/* Basis: why, and the numbers. */}
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
        <span className={mutedClass}>為什麼：</span>
        {item.reading}
        <span className={`ml-2 ${mutedClass}`}>
          （{item.date} 收盤 {item.close}）
        </span>
      </p>
      <LevelLines levels={lv} />
      {ex.numbers.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          {ex.numbers.map((n) => (
            <div key={n.label} className="flex items-baseline gap-1.5">
              <dt className={mutedClass}>{n.label}</dt>
              <dd className="text-sm font-medium text-gray-900 tabular-nums dark:text-gray-100">{n.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {pending && <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">下一步：{ex.todo}</p>}
      {/* Detail: how it was computed. */}
      {item.basis.length > 0 && (
        <Disclosure summary="怎麼算的">
          <ul className="space-y-0.5">
            {item.basis.map((b) => (
              <li key={b} className={mutedClass}>
                {b}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {pending && canAct && (
        <div className="mt-2">
          {item.kind === 'enter' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-xs whitespace-nowrap text-gray-600 dark:text-gray-300">
                股數
                <input type="number" step="1" className={`${inputClass} w-28`} value={shares} onChange={(e) => setShares(e.target.value)} />
              </label>
              <label className="flex items-center gap-1 text-xs whitespace-nowrap text-gray-600 dark:text-gray-300">
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
  const summary = adviceSummary(items)
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
        <p className={`mt-3 ${mutedClass}`}>交易日收盤後打開網站會自動執行「更新收盤價並產生建議」（也可以按頁首的按鈕，或「今日」頁的「執行今日例行」）：助手會依策略卡規則逐檔判斷，並以每筆風險計算股數、設好停損。</p>
      ) : (
        <>
          {/* The day's conclusion first. */}
          <div className={`mt-3 rounded-md p-3 ${summary.actionable > 0 ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'bg-gray-50 dark:bg-gray-900/40'}`}>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{summary.headline}</p>
            {summary.detail && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{summary.detail}</p>}
            <p className={`mt-1 ${mutedClass}`}>
              依 {snap.date} 收盤、策略卡「{strategy.name}」的規則產生（{new Date(snap.generatedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）。建議只在下一次產生前有效；隔天沒處理的會記為「未處理」。
            </p>
          </div>
          <Disclosure summary="這些建議怎麼來的？">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">
              <li>逐檔套用策略卡的進出場規則：持股看出場訊號與停損，未持有的看進場訊號。</li>
              <li>停損 = 收盤 − k × ATR(14)：k 用策略卡的倍數，局勢表有設時改用局勢的；策略卡沒有停損規則時給 2.5 倍的保護停損。</li>
              <li>股數 = 總資金（全部虛擬帳戶合計）× 每筆風險 ÷（價格 − 停損），再乘局勢的部位倍數；所有帳戶的未平倉停損風險合計不超過總資金 6%，並受這個帳戶的現金、單一部位上限與持有檔數限制。</li>
              <li>進場價、出場價：下一次判斷時（日頻是下個交易日收盤，週頻是判斷日收盤）收盤要到多少才觸發，由策略卡的規則反推，另附離今天收盤多遠；外資買賣超、動能排名、持有天數這類不是價格的條件直接寫出來。出場價同時列出停損。</li>
              <li>持股的吊燈停損（進場後最高價 − k × ATR）高於目前停損時，建議上調；收盤離停損不到 {Math.round(NEAR_STOP * 100)}% 時提醒。</li>
              <li>下單前檢查：價格是否最新、有沒有停損、風險是否超過上限、現金夠不夠；必須項沒過就不能下單。</li>
            </ol>
          </Disclosure>
          {actions.length > 0 && (
            <>
              <h4 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">要處理（{actions.length}）</h4>
              <ul className="mt-2 space-y-2">
                {actions.map((i) => (
                  <ActionRow key={`${i.kind}${i.symbol}${snap.generatedAt}`} item={i} ctx={ctx} />
                ))}
              </ul>
            </>
          )}
          {(holds.length > 0 || waits.length > 0) && (
            <>
              <h4 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">不用動作（{holds.length + waits.length}）</h4>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      {['標的', '狀態', '進場價／出場價', '規則讀數', '停損與損益'].map((h) => (
                        <th key={h} className="py-1.5 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...holds, ...waits].map((i) => {
                      const e = explainItem(i, account, ctx.accounts)
                      const lv = priceLevels(i, account)
                      return (
                        <tr key={`${i.kind}${i.symbol}`} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-700">
                          <td className="py-1.5 pr-3 whitespace-nowrap text-gray-900 dark:text-gray-100">{formatSymbol(i.symbol)}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            <Badge tone="info">{ASSISTANT_KIND_LABELS[i.kind]}</Badge>
                          </td>
                          <td className="min-w-[17rem] py-1.5 pr-3 text-xs text-gray-900 tabular-nums dark:text-gray-100">
                            <span className="block">
                              <span className={mutedClass}>進場 </span>
                              {lv.entry}
                            </span>
                            <span className="block">
                              <span className={mutedClass}>出場 </span>
                              {lv.exit}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{i.reading}</td>
                          <td className="py-1.5 pr-3 text-xs text-gray-600 dark:text-gray-400">{[...i.basis, ...e.numbers.map((n) => `${n.label} ${n.value}`)].join('；') || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
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
