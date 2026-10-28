import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { STARTER_STRATEGIES, type StarterStrategy } from '../lib/backtest/starterStrategies'
import { SimGuide } from '../components/SimGuide'
import { useAppStore } from '../lib/storage/appStore'
import { STRATEGY_STATUS_LABELS, STRATEGY_TEMPLATES, formatSymbol, resolveParams } from '../lib/backtest/templates'
import { liveGate, PAPER_RULES } from '../lib/calculations/strategyProgress'
import { todayIsoDate } from '../lib/market/twse'
import { StrategyForm, type StrategyFormValues } from '../components/forms/StrategyForm'
import type { StrategyStatus } from '../lib/storage/schema'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

const STATUS_STYLE: Record<StrategyStatus, string> = {
  dev: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  paper: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  live: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  retired: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
}

export function StrategiesPage() {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const runs = useAppStore((s) => s.backtestRuns)
  const accounts = useAppStore((s) => s.paperAccounts)
  const policy = useAppStore((s) => s.investmentPolicy)
  const addTradingStrategy = useAppStore((s) => s.addTradingStrategy)
  const updateTradingStrategy = useAppStore((s) => s.updateTradingStrategy)
  const removeTradingStrategy = useAppStore((s) => s.removeTradingStrategy)

  // null = form closed, 'new' = creating, otherwise the id being edited
  const navigate = useNavigate()
  const [editing, setEditing] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(strategies.length === 0)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const today = todayIsoDate()
  const editingStrategy = editing && editing !== 'new' ? strategies.find((s) => s.id === editing) : undefined

  function applyStarter(starter: StarterStrategy, thenBacktest: boolean) {
    const id = addTradingStrategy({ ...starter.card, status: 'dev' })
    if (thenBacktest) navigate(`/sim/backtest?strategy=${id}`)
  }

  function handleSubmit(values: StrategyFormValues) {
    if (editingStrategy) updateTradingStrategy(editingStrategy.id, values)
    else addTradingStrategy({ ...values, status: 'dev' })
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">策略卡</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        每個交易策略先寫成策略卡：優勢、進出場規則、每筆風險。流程是「開發中 → 回測通過 → 虛擬交易 {PAPER_RULES.months} 個月、
        {PAPER_RULES.fills} 筆 → 實單」，兩關都過才能改成實單。說明見手冊{' '}
        <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          10 交易策略開發與回測
        </Link>
        。
      </p>

      <SimGuide />

      <div className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">範本庫</h2>
          <button type="button" onClick={() => setLibraryOpen((v) => !v)} className={linkClass}>
            {libraryOpen ? '收合' : `展開 ${STARTER_STRATEGIES.length} 個入門策略`}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          寫好優勢與進出場規則的入門策略。套用後會成為你的策略卡（開發中），可以再修改；建議第一次從「0050 均線趨勢」開始。
        </p>
        {libraryOpen && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STARTER_STRATEGIES.map((st) => {
              const def = STRATEGY_TEMPLATES[st.card.template]
              const applied = strategies.some((s) => s.name === st.card.name)
              return (
                <div key={st.id} className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{st.card.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {def.label}（{def.origin}）{st.card.symbols.length > 0 && `・${st.card.symbols.map(formatSymbol).join('、')}`}
                  </p>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{st.card.edge}</p>
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">適合：{st.suits}</p>
                  <p className="text-xs text-orange-700 dark:text-orange-400">風險：{st.risk}</p>
                  <div className="mt-3 flex gap-3">
                    {def.backtestable && (
                      <button
                        type="button"
                        onClick={() => applyStarter(st, true)}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        套用並回測
                      </button>
                    )}
                    <button type="button" onClick={() => applyStarter(st, false)} className={linkClass}>
                      {applied ? '再套用一份' : '套用'}
                    </button>
                    {!def.backtestable && <span className="text-xs text-gray-500">無法自動回測，套用後直接用虛擬帳戶練習</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing ? (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingStrategy ? `編輯策略卡：${editingStrategy.name}` : '新增策略卡'}
          </h2>
          <div className="mt-4">
            <StrategyForm
              key={editing}
              initial={editingStrategy}
              defaultRiskPercent={policy.riskPerTradePercent}
              onSubmit={handleSubmit}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          新增策略卡
        </button>
      )}

      <div className="mt-6 space-y-4">
        {strategies.map((s) => {
          const def = STRATEGY_TEMPLATES[s.template]
          const gate = liveGate(s, runs, accounts, today)
          const params = resolveParams(s.template, s.params)
          const ownRuns = runs.filter((r) => r.strategyId === s.id).length
          const ownAccounts = accounts.filter((a) => a.strategyId === s.id).length
          return (
            <div key={s.id} className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{s.name}</h3>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>
                  {STRATEGY_STATUS_LABELS[s.status]}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {def.label}・{s.symbols.map(formatSymbol).join('、') || '未設定標的'}・每筆風險 {s.riskPerTradePercent}%
                </span>
              </div>
              {def.params.length > 0 && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {def.params.map((x) => `${x.label} ${params[x.key]}`).join('｜')}
                </p>
              )}
              <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                {[
                  ['優勢', s.edge],
                  ['進場', s.entryRules],
                  ['出場', s.exitRules],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{k}</dt>
                    <dd className="whitespace-pre-line text-gray-700 dark:text-gray-300">{v || '—'}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                {gate.backtestPassed ? '✓' : '☐'} 回測樣本外勝過買進持有（報酬或風險調整後；{ownRuns} 次回測）
                {gate.paperProven ? '✓' : '☐'} 虛擬交易 {PAPER_RULES.months} 個月、{PAPER_RULES.fills} 筆（{ownAccounts} 個帳戶）
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {def.backtestable && (
                  <Link to={`/sim/backtest?strategy=${s.id}`} className={linkClass}>
                    回測
                  </Link>
                )}
                <Link to={`/sim/paper?strategy=${s.id}`} className={linkClass}>
                  虛擬帳戶
                </Link>
                <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                  狀態
                  <select
                    className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
                    value={s.status}
                    onChange={(e) => updateTradingStrategy(s.id, { status: e.target.value as StrategyStatus })}
                  >
                    {(Object.keys(STRATEGY_STATUS_LABELS) as StrategyStatus[]).map((st) => (
                      <option key={st} value={st} disabled={st === 'live' && !gate.allowed && s.status !== 'live'}>
                        {STRATEGY_STATUS_LABELS[st]}
                        {st === 'live' && !gate.allowed ? '（需通過回測與虛擬交易）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setEditing(s.id)} className={linkClass}>
                  編輯
                </button>
                {pendingDeleteId === s.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        removeTradingStrategy(s.id)
                        setPendingDeleteId(null)
                      }}
                      className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                    >
                      確定刪除
                    </button>
                    <button type="button" onClick={() => setPendingDeleteId(null)} className="text-xs text-gray-500 hover:underline">
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(s.id)}
                    className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                  >
                    刪除
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
