import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import type { StrategyStatus, TradingStrategy } from '../../lib/storage/schema'
import { STRATEGY_STATUS_LABELS, STRATEGY_TEMPLATES, resolveParams } from '../../lib/backtest/templates'
import { liveGate, paperRulesFor } from '../../lib/calculations/strategyProgress'
import { cadenceLabel } from '../../lib/backtest/weekly'
import { GROUP_BY_LABELS, cleanupSuggestions, groupCards, symbolLabel, symbolNames, type GroupBy } from '../../lib/backtest/cardGroups'
import { todayIsoDate } from '../../lib/market/twse'
import { StrategyResearchLinks } from '../research/StrategyResearchLinks'
import { inputClass } from '../forms/FormField'

const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'
const mutedClass = 'text-xs text-gray-500 dark:text-gray-400'
// Outlined: the page's one solid button is 「新增策略卡」 in the header (docs/ui-guidelines.md §2).
const nextButton =
  'rounded-md border border-indigo-600 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-indigo-700 hover:bg-indigo-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-900/30'

const STATUS_STYLE: Record<StrategyStatus, string> = {
  dev: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  paper: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  live: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  retired: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const GROUP_KEY = 'pfm:cardGroupBy'
const FILTERS: { key: 'all' | StrategyStatus; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'live', label: '實單' },
  { key: 'paper', label: '虛擬交易' },
  { key: 'dev', label: '開發中' },
]

function readGroupBy(): GroupBy {
  try {
    const v = localStorage.getItem(GROUP_KEY)
    return v === 'status' || v === 'template' || v === 'cadence' ? v : 'symbol'
  } catch {
    return 'symbol'
  }
}

interface Props {
  onEdit: (id: string) => void
  // A card to open and scroll to (?card=id).
  focusId?: string | null
}

// 我的策略卡, sorted into groups (by symbol, status or template) so the
// list stays readable as comparisons add cards; each card is one line
// until opened.
export function StrategyCardList({ onEdit, focusId }: Props) {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const runs = useAppStore((s) => s.backtestRuns)
  const accounts = useAppStore((s) => s.paperAccounts)
  const watchlist = useAppStore((s) => s.watchlist)
  const theses = useAppStore((s) => s.stockTheses)
  const holdings = useAppStore((s) => s.holdings)
  const updateTradingStrategy = useAppStore((s) => s.updateTradingStrategy)
  const removeTradingStrategy = useAppStore((s) => s.removeTradingStrategy)
  const today = todayIsoDate()

  const [by, setBy] = useState<GroupBy>(readGroupBy)
  const globalDay = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay)
  const [filter, setFilter] = useState<'all' | StrategyStatus>('all')
  const [query, setQuery] = useState('')
  const [openCards, setOpenCards] = useState<string[]>(focusId ? [focusId] : [])
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const names = useMemo(() => symbolNames({ watchlist, stockTheses: theses, paperAccounts: accounts, holdings }), [watchlist, theses, accounts, holdings])
  const q = query.trim().toUpperCase()
  const shown = strategies.filter(
    (s) => (filter === 'all' || s.status === filter) && (!q || s.name.toUpperCase().includes(q) || s.symbols.some((x) => x.toUpperCase().includes(q) || (names[x] ?? '').includes(query.trim()))),
  )
  const groups = groupCards(shown, by, { runs, accounts, names })
  const live = groups.filter((g) => !g.retired)
  const suggestions = cleanupSuggestions(strategies, runs, accounts, today)
  // Few groups: all open. Many: those with live or paper cards, and any
  // the search or a link points at.
  const openByDefault = (g: (typeof groups)[number]) => !g.retired && (live.length <= 3 || g.active || q !== '' || g.cards.some((c) => c.id === focusId))
  const isOpen = (g: (typeof groups)[number]) => toggled[`${by}:${g.key}`] ?? openByDefault(g)

  useEffect(() => {
    if (focusId) document.getElementById(`card-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId])

  function chooseBy(next: GroupBy) {
    setBy(next)
    try {
      localStorage.setItem(GROUP_KEY, next)
    } catch {
      // A remembered choice is a convenience only.
    }
  }

  const toggleCard = (id: string) => setOpenCards((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  function nextStep(s: TradingStrategy, gate: ReturnType<typeof liveGate>) {
    const def = STRATEGY_TEMPLATES[s.template]
    if (s.status === 'retired') return null
    // Real-money entries start from a trade plan.
    if (s.status === 'live')
      return (
        <Link to={`/portfolio/plans?strategy=${encodeURIComponent(s.id)}`} className={nextButton}>
          下一步：建立計畫單 →
        </Link>
      )
    if (def.backtestable && !gate.backtestPassed)
      return (
        <Link to={`/sim/compare?strategy=${s.id}`} className={nextButton}>
          下一步：比較與回測 →
        </Link>
      )
    if (!gate.paperProven)
      return (
        <Link to={`/sim/paper?strategy=${s.id}`} className={nextButton}>
          下一步：虛擬交易 →
        </Link>
      )
    if (!gate.allowed) return null
    return (
      <button type="button" onClick={() => updateTradingStrategy(s.id, { status: 'live' })} className={nextButton}>
        下一步：改為實單
      </button>
    )
  }

  function row(s: TradingStrategy) {
    const def = STRATEGY_TEMPLATES[s.template]
    const gate = liveGate(s, runs, accounts, today)
    const params = resolveParams(s.template, s.params)
    const ownRuns = runs.filter((r) => r.strategyId === s.id).length
    const ownAccounts = accounts.filter((a) => a.strategyId === s.id).length
    const open = openCards.includes(s.id)
    return (
      <li key={s.id} id={`card-${s.id}`} className={`border-b border-gray-100 py-2 last:border-0 dark:border-gray-700 ${s.id === focusId ? 'rounded-md bg-indigo-50/60 px-2 dark:bg-indigo-900/20' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={() => toggleCard(s.id)} aria-expanded={open} className="min-w-0 text-left text-sm font-medium text-gray-900 hover:underline dark:text-gray-100">
            {open ? '▾' : '▸'} {s.name}
          </button>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>{STRATEGY_STATUS_LABELS[s.status]}</span>
          <span className={mutedClass}>
            {def.label}・{cadenceLabel(s, globalDay)}
            {by !== 'symbol' && `・${symbolLabel(s.symbols, names)}`}
          </span>
          <span className={mutedClass}>
            {gate.backtestPassed ? '✓' : '☐'} 回測 {gate.paperProven ? '✓' : '☐'} 虛擬
          </span>
          <span className="ml-auto">{nextStep(s, gate)}</span>
        </div>
        {open && (
          <div className="mt-2 pl-4">
            <p className={mutedClass}>
              {symbolLabel(s.symbols, names)}・每筆風險 {s.riskPerTradePercent}%{def.params.length > 0 && `・${def.params.map((x) => `${x.label} ${params[x.key]}`).join('｜')}`}
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
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
            <StrategyResearchLinks strategy={s} />
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {gate.backtestPassed ? '✓' : '☐'} 回測樣本外勝過買進持有（報酬或風險調整後；{ownRuns} 次回測）
              {gate.paperProven ? '✓' : '☐'} 虛擬交易 {paperRulesFor(s).months} 個月、{paperRulesFor(s).fills} 筆（{ownAccounts} 個帳戶）
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {def.backtestable && (
                <Link to={`/sim/compare?strategy=${s.id}`} className={linkClass}>
                  比較與回測
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
              <button type="button" onClick={() => onEdit(s.id)} className={linkClass}>
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
                  <button type="button" onClick={() => setPendingDeleteId(null)} className="text-xs text-gray-600 hover:underline dark:text-gray-400">
                    取消
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setPendingDeleteId(s.id)} className="text-xs font-medium text-gray-600 hover:underline dark:text-gray-400">
                  刪除
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    )
  }

  if (strategies.length === 0) return <p className={`mt-3 ${mutedClass}`}>還沒有策略卡：從上方範本庫「套用」，或在比較與回測的結果「建立策略卡」。</p>

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" role="group" aria-label="分組方式">
          分組
          {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={by === k}
              onClick={() => chooseBy(k)}
              className={`rounded px-2 py-1 ${by === k ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700'}`}
            >
              {GROUP_BY_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="w-32">
          <select className={`${inputClass} py-1 text-xs`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="狀態篩選">
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-56">
          <input className={`${inputClass} py-1 text-xs`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋名稱或代號" aria-label="搜尋策略卡" />
        </div>
      </div>

      {suggestions.length > 0 && (
        <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
          <summary className="cursor-pointer text-amber-900 dark:text-amber-200">整理建議：{suggestions.length} 張卡可以停用（停用不會刪除，之後可以改回）</summary>
          <ul className="mt-2 space-y-1">
            {suggestions.map(({ card, reason }) => (
              <li key={card.id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">{card.name}</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">{reason}</span>
                <button type="button" onClick={() => updateTradingStrategy(card.id, { status: 'retired' })} className={linkClass}>
                  停用
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {groups.length === 0 && <p className={`mt-3 ${mutedClass}`}>沒有符合的策略卡。</p>}
      <div className="mt-3 space-y-2">
        {groups.map((g) => {
          const open = isOpen(g)
          return (
            <section key={g.key} className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((t) => ({ ...t, [`${by}:${g.key}`]: !open }))}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
              >
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {open ? '▾' : '▸'} {g.label}
                </span>
                <span className={mutedClass}>{g.summary}</span>
              </button>
              {open && <ul className="border-t border-gray-100 px-4 dark:border-gray-700">{g.cards.map(row)}</ul>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
