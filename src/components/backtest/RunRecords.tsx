import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import type { BacktestRun } from '../../lib/storage/schema'
import { backtestPasses } from '../../lib/calculations/strategyProgress'
import { groupCards, symbolLabel, symbolNames } from '../../lib/backtest/cardGroups'

const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 align-top whitespace-nowrap text-gray-700 dark:text-gray-300'
const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`)

interface Line {
  key: string
  name: string
  cardId?: string
  runs: BacktestRun[]
}

// Saved backtests, grouped by symbol like the strategy cards: one line per
// card with its latest run, earlier runs on request. The group of the
// symbols being compared opens first.
export function RunRecords({ symbols }: { symbols: string[] }) {
  const runs = useAppStore((s) => s.backtestRuns)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const accounts = useAppStore((s) => s.paperAccounts)
  const watchlist = useAppStore((s) => s.watchlist)
  const theses = useAppStore((s) => s.stockTheses)
  const holdings = useAppStore((s) => s.holdings)
  const removeBacktestRun = useAppStore((s) => s.removeBacktestRun)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [history, setHistory] = useState<string[]>([])

  const names = useMemo(() => symbolNames({ watchlist, stockTheses: theses, paperAccounts: accounts, holdings }), [watchlist, theses, accounts, holdings])
  const byCard = (id: string) => runs.filter((r) => r.strategyId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const groups = groupCards(
    strategies.filter((s) => runs.some((r) => r.strategyId === s.id)),
    'symbol',
    { runs, accounts, names },
  ).map((g) => ({ key: g.key, label: g.label, lines: g.cards.map((c): Line => ({ key: c.id, name: c.name, cardId: c.id, runs: byCard(c.id) })) }))
  // Runs whose card is gone or never existed, by their own symbols.
  const loose = runs.filter((r) => !r.strategyId || !strategies.some((s) => s.id === r.strategyId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (loose.length > 0) groups.push({ key: 'loose', label: '未連結策略卡', lines: loose.map((r) => ({ key: r.id, name: `${r.label}（${symbolLabel(r.symbols, names)}）`, runs: [r] })) })
  if (groups.length === 0) return null

  const current = [...symbols].sort().join(',')
  const isOpen = (key: string) => toggled[key] ?? (groups.length <= 3 || key === current)
  const runCells = (r: BacktestRun) => (
    <>
      <td className={`${tdClass} text-xs`}>
        {r.start}～{r.end}
        {r.cadence === 'weekly' && <span className="ml-1 text-gray-500 dark:text-gray-400">・每週</span>}
      </td>
      <td className={tdClass}>{pct(r.stats.outOfSample?.cagr)}</td>
      <td className={tdClass}>{pct(r.benchmark.outOfSample?.cagr)}</td>
      <td className={tdClass}>{pct(r.stats.full.maxDrawdown)}</td>
      <td className={tdClass}>{backtestPasses(r) ? '✓ 通過' : '✗'}</td>
      <td className={tdClass}>
        <button type="button" onClick={() => removeBacktestRun(r.id)} className="text-xs text-gray-600 hover:underline dark:text-gray-400">
          刪除
        </button>
      </td>
    </>
  )

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">回測紀錄（{runs.length}）</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">依標的分組，每張策略卡一行、顯示最新一次；策略卡要有一筆通過，才能進虛擬交易與實單（行動路線 4.2）。</p>
      <div className="mt-3 space-y-2">
        {groups.map((g) => {
          const open = isOpen(g.key)
          const count = g.lines.reduce((n, l) => n + l.runs.length, 0)
          return (
            <section key={g.key} className="rounded-md border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((t) => ({ ...t, [g.key]: !open }))}
                className="flex w-full flex-wrap items-baseline gap-x-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
              >
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {open ? '▾' : '▸'} {g.label}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {g.key === 'loose' ? `${count} 筆` : `${g.lines.length} 張卡、${count} 筆回測`}
                </span>
              </button>
              {open && (
                <div className="overflow-x-auto border-t border-gray-100 px-3 dark:border-gray-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        {['名稱', '期間', '樣本外年化', '買進持有', '最大回撤', '結果', ''].map((h) => (
                          <th key={h} className={thClass}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((l) => {
                        const [latest, ...older] = l.runs
                        const showOlder = history.includes(l.key)
                        return (
                          <Fragment key={l.key}>
                            <tr className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                              <td className={`${tdClass} whitespace-normal`}>
                                {l.cardId ? (
                                  <Link to={`/sim/strategies?card=${l.cardId}`} className="font-medium text-gray-900 hover:underline dark:text-gray-100">
                                    {l.name}
                                  </Link>
                                ) : (
                                  l.name
                                )}
                                {older.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setHistory((h) => (showOlder ? h.filter((x) => x !== l.key) : [...h, l.key]))}
                                    className="ml-2 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                                  >
                                    {showOlder ? '收合較早' : `較早 ${older.length} 筆`}
                                  </button>
                                )}
                              </td>
                              {runCells(latest)}
                            </tr>
                            {showOlder &&
                              older.map((r) => (
                                <tr key={r.id} className="border-b border-gray-100 bg-gray-50/60 last:border-0 dark:border-gray-700 dark:bg-gray-900/30">
                                  <td className={`${tdClass} pl-4 text-xs text-gray-500 dark:text-gray-400`}>{r.createdAt.slice(0, 10)} 存</td>
                                  {runCells(r)}
                                </tr>
                              ))}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
