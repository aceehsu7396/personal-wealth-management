import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import {
  cancelOrder,
  equityOf,
  paperStats,
  placeOrder,
  setStopLoss,
  updatePrices,
  type NewOrder,
  type Quote,
} from '../lib/paper/paperAccount'
import { latestSignals, type SignalSuggestion } from '../lib/backtest/engine'
import { loadPriceData } from '../lib/backtest/data'
import { STRATEGY_TEMPLATES, formatSymbol, parseSymbolList } from '../lib/backtest/templates'
import { PAPER_RULES } from '../lib/calculations/strategyProgress'
import { fetchLatestTwseBar, isoDaysAgo, loadSeries, seriesForBacktest, TWSE_REQUEST_GAP_MS } from '../lib/market/priceHistory'
import { todayIsoDate } from '../lib/market/twse'
import { describeAiError } from '../lib/ai/client'
import { EquityChart } from '../components/charts/BacktestCharts'
import { StatCard } from '../components/StatCard'
import { SimGuide } from '../components/SimGuide'
import { Field, inputClass } from '../components/forms/FormField'
import type { PaperAccount, PaperOrder } from '../lib/storage/schema'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 text-gray-700 dark:text-gray-300'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'
const EMOTIONS = ['1 極度恐懼', '2 恐懼', '3 平靜', '4 貪婪', '5 極度貪婪']

function money(v: number): string {
  return Math.round(v).toLocaleString('zh-TW')
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Latest daily bars for TW symbols (TWSE); US prices come from the form.
async function fetchQuotes(symbols: string[], today: string, onStep: (s: string) => void): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {}
  for (const [i, symbol] of symbols.filter((s) => s.startsWith('TW:')).entries()) {
    if (i > 0) await sleep(TWSE_REQUEST_GAP_MS)
    onStep(`取得 ${formatSymbol(symbol)} 最新收盤價…`)
    const bar = await fetchLatestTwseBar(symbol.slice(3), today)
    if (bar) out[symbol] = { price: bar.close, date: bar.date, open: bar.open, high: bar.high, low: bar.low }
  }
  return out
}

function CreateAccount({ defaultStrategyId, onCreate }: { defaultStrategyId: string; onCreate: (a: Omit<PaperAccount, 'id' | 'createdAt'>) => void }) {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const [name, setName] = useState('')
  const [market, setMarket] = useState<'TW' | 'US'>('TW')
  const [cash, setCash] = useState(1_000_000)
  const [strategyId, setStrategyId] = useState(defaultStrategyId)
  const strategy = strategies.find((s) => s.id === strategyId)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <Field label="帳戶名稱">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={strategy?.name ?? '例：0050 均線練習'} />
      </Field>
      <Field label="連結策略卡">
        <select className={inputClass} value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
          <option value="">（不連結）</option>
          {strategies
            .filter((s) => s.status !== 'retired')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="市場">
        <select className={inputClass} value={market} onChange={(e) => setMarket(e.target.value as 'TW' | 'US')}>
          <option value="TW">台股（新台幣，自動取價）</option>
          <option value="US">美股（美元，手動輸入價格）</option>
        </select>
      </Field>
      <Field label="初始資金">
        <input type="number" step="10000" className={inputClass} value={cash} onChange={(e) => setCash(Number(e.target.value))} />
      </Field>
      <div className="sm:col-span-4">
        <button
          type="button"
          disabled={!(cash > 0)}
          onClick={() =>
            onCreate({
              name: name.trim() || strategy?.name || '虛擬帳戶',
              strategyId: strategyId || undefined,
              market,
              initialCash: cash,
              cash,
              positions: [],
              orders: [],
              equityHistory: [],
            })
          }
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          建立虛擬帳戶
        </button>
      </div>
    </div>
  )
}

export function PaperPage() {
  const [search] = useSearchParams()
  const accounts = useAppStore((s) => s.paperAccounts)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const runs = useAppStore((s) => s.backtestRuns)
  const addPaperAccount = useAppStore((s) => s.addPaperAccount)
  const replacePaperAccount = useAppStore((s) => s.replacePaperAccount)
  const removePaperAccount = useAppStore((s) => s.removePaperAccount)
  const updateTradingStrategy = useAppStore((s) => s.updateTradingStrategy)

  const presetStrategy = search.get('strategy') ?? ''
  const preset = accounts.find((a) => a.strategyId === presetStrategy)
  const [selectedId, setSelectedId] = useState<string | null>(preset?.id ?? accounts[0]?.id ?? null)
  const [creating, setCreating] = useState(accounts.length === 0 || (presetStrategy !== '' && !preset))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signals, setSignals] = useState<SignalSuggestion[] | null>(null)
  const [manualPrices, setManualPrices] = useState<Record<string, string>>({})
  const [order, setOrder] = useState({ symbol: '', side: 'buy' as 'buy' | 'sell', type: 'market' as PaperOrder['type'], shares: '', price: '', stopLoss: '', reason: '', emotion: 3 })
  const [pendingDelete, setPendingDelete] = useState(false)

  const today = todayIsoDate()
  const account = accounts.find((a) => a.id === selectedId)
  const strategy = strategies.find((s) => s.id === account?.strategyId)

  function save(next: PaperAccount) {
    replacePaperAccount(next)
    setError(null)
  }

  async function guarded(label: string, task: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(describeAiError(e))
    } finally {
      setBusy(null)
    }
  }

  // Manual US prices for the given symbols, as quotes dated today.
  function manualQuotes(symbols: string[]): Record<string, Quote> {
    return Object.fromEntries(
      symbols
        .filter((s) => Number(manualPrices[s]) > 0)
        .map((s) => [s, { price: Number(manualPrices[s]), date: today }]),
    )
  }

  async function refreshPrices() {
    if (!account) return
    const symbols = [...new Set([...account.positions.map((p) => p.symbol), ...account.orders.filter((o) => o.status === 'open').map((o) => o.symbol)])]
    await guarded('更新價格…', async () => {
      const quotes = account.market === 'TW' ? await fetchQuotes(symbols, today, setBusy) : manualQuotes(symbols)
      save(updatePrices(useAppStore.getState().paperAccounts.find((a) => a.id === account.id)!, quotes))
    })
  }

  async function submitOrder(input: NewOrder) {
    if (!account) return
    await guarded('下單中…', async () => {
      let quote: Quote | undefined
      if (input.type === 'market') {
        if (account.market === 'TW') quote = (await fetchQuotes([input.symbol], today, setBusy))[input.symbol]
        else {
          // US prices are typed in: the order form's price, or the price
          // entered for that symbol above.
          const price = Number(order.price) || Number(manualPrices[input.symbol])
          if (price > 0) quote = { price, date: today }
        }
        if (!quote) throw new Error(account.market === 'TW' ? '取不到最新收盤價（上櫃股票不支援）' : '請填寫成交價')
      }
      const current = useAppStore.getState().paperAccounts.find((a) => a.id === account.id)!
      save(placeOrder(current, input, quote))
    })
  }

  function submitForm() {
    const [symbol] = parseSymbolList(account?.market === 'US' ? `US:${order.symbol.replace(/^US:/i, '')}` : order.symbol)
    if (!symbol) return setError('請填寫代號')
    const position = account?.positions.find((p) => p.symbol === symbol)
    void submitOrder({
      symbol,
      name: position?.name ?? '',
      side: order.side,
      type: order.type,
      price: order.type !== 'market' ? Number(order.price) : undefined,
      shares: Number(order.shares),
      stopLoss: order.side === 'buy' && Number(order.stopLoss) > 0 ? Number(order.stopLoss) : undefined,
      reason: order.reason.trim(),
      emotion: order.emotion,
    })
  }

  async function makeSignals() {
    if (!account || !strategy) return
    await guarded('計算今日訊號…', async () => {
      const symbols = strategy.symbols
      const data = await loadPriceData(symbols, isoDaysAgo(today, 1), today, (p) => setBusy(`下載 ${formatSymbol(p.symbol)} ${p.done}/${p.total}`))
      const held = Object.fromEntries(account.positions.map((p) => [p.symbol, { shares: p.shares, openedAt: p.openedAt }]))
      setSignals(latestSignals(strategy.template, strategy.params, data, held, equityOf(account)))
    })
  }

  // Equity vs 0050 (when its prices are cached), both starting at 100.
  function equityPoints() {
    if (!account || account.equityHistory.length === 0) return []
    const tw50 = loadSeries('TW:0050')
    const bars = tw50 ? seriesForBacktest(tw50).bars : []
    const at = (date: string) => [...bars].reverse().find((b) => b.date <= date)?.close
    const base = at(account.equityHistory[0].date)
    return account.equityHistory.map((p) => ({
      date: p.date,
      strategy: (p.equity / account.initialCash) * 100,
      benchmark: base ? ((at(p.date) ?? base) / base) * 100 : 100,
    }))
  }

  const stats = account ? paperStats(account, today) : null
  const ownRun = account?.strategyId ? [...runs].reverse().find((r) => r.strategyId === account.strategyId) : undefined
  const openOrders = account?.orders.filter((o) => o.status === 'open') ?? []
  const filled = account ? [...account.orders].filter((o) => o.status === 'filled').reverse() : []

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">虛擬帳戶</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        用虛擬資金照策略卡下單：市價單以最新收盤價成交，限價單與停損在之後的交易日觸價成交，成本與回測相同。連結策略卡的帳戶操作滿{' '}
        {PAPER_RULES.months} 個月、{PAPER_RULES.fills} 筆成交，就完成行動路線 4.3。說明見手冊{' '}
        <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          10 §7
        </Link>
        。
      </p>

      <SimGuide />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setSelectedId(a.id)
              setCreating(false)
              setSignals(null)
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${a.id === selectedId && !creating ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700'}`}
          >
            {a.name}
          </button>
        ))}
        <button type="button" onClick={() => setCreating(true)} className={linkClass}>
          ＋ 新增帳戶
        </button>
      </div>

      {creating && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">新增虛擬帳戶</h2>
          <div className="mt-4">
            <CreateAccount
              defaultStrategyId={presetStrategy}
              onCreate={(a) => {
                const id = addPaperAccount(a)
                setSelectedId(id)
                setCreating(false)
                if (a.strategyId) {
                  const s = strategies.find((x) => x.id === a.strategyId)
                  if (s?.status === 'dev') updateTradingStrategy(s.id, { status: 'paper' })
                }
              }}
            />
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {busy && <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">{busy}</p>}

      {account && stats && !creating && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="帳戶權益" value={money(stats.equity)} hint={`現金 ${money(account.cash)}（${account.market === 'TW' ? '新台幣' : '美元'}）`} />
            <StatCard label="累計報酬" value={pct(stats.totalReturn)} hint={`最大回撤 ${pct(stats.maxDrawdown)}`} />
            <StatCard
              label="平倉交易"
              value={`${stats.closed} 筆`}
              hint={`勝率 ${pct(stats.winRate)}・平均 R ${stats.avgR === null ? '—' : stats.avgR.toFixed(2)}`}
            />
            <StatCard
              label="4.3 進度"
              value={`${Math.min(stats.months, PAPER_RULES.months)}/${PAPER_RULES.months} 月`}
              hint={`${Math.min(stats.fills, PAPER_RULES.fills)}/${PAPER_RULES.fills} 筆成交${account.strategyId ? '' : '（需連結策略卡）'}`}
            />
          </div>

          <div className={cardClass}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{account.name}</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {strategy ? `策略卡：${strategy.name}（${STRATEGY_TEMPLATES[strategy.template].label}）` : '未連結策略卡'}
                {ownRun?.stats.full && `・回測年化 ${pct(ownRun.stats.full.cagr)}`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void refreshPrices()}
                className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
              >
                更新價格（觸發停損與限價單）
              </button>
              {strategy && STRATEGY_TEMPLATES[strategy.template].backtestable && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void makeSignals()}
                  className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
                >
                  產生今日策略訊號
                </button>
              )}
            </div>

            {account.market === 'US' && (
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {[...new Set([...account.positions.map((p) => p.symbol), ...openOrders.map((o) => o.symbol)])].map((s) => (
                  <label key={s} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                    {formatSymbol(s)} 最新價
                    <input
                      type="number"
                      step="any"
                      className="w-24 rounded border border-gray-300 px-1 py-0.5 dark:border-gray-600 dark:bg-gray-800"
                      value={manualPrices[s] ?? ''}
                      onChange={(e) => setManualPrices({ ...manualPrices, [s]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            )}

            {signals && (
              <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
                <p className="font-medium text-gray-800 dark:text-gray-200">今日策略訊號</p>
                {signals.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">沒有新訊號：照規則什麼都不做也是一種紀律。</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {signals.map((sg) => (
                      <li key={`${sg.side}${sg.symbol}`} className="flex flex-wrap items-center gap-3">
                        <span className={sg.side === 'buy' ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'}>
                          {sg.side === 'buy' ? '買進' : '賣出'} {formatSymbol(sg.symbol)} {sg.shares} 股
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {sg.reason}・{sg.date} 收盤 {sg.close}
                          {sg.stopLoss !== undefined && `・停損 ${sg.stopLoss}`}
                        </span>
                        <button
                          type="button"
                          className={linkClass}
                          disabled={busy !== null || sg.shares <= 0}
                          onClick={() =>
                            void submitOrder({
                              symbol: sg.symbol,
                              name: '',
                              side: sg.side,
                              type: 'market',
                              shares: sg.shares,
                              stopLoss: sg.stopLoss,
                              reason: `策略訊號：${sg.reason}`,
                            }).then(() => setSignals((list) => list?.filter((x) => x !== sg) ?? null))
                          }
                        >
                          依訊號下單
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">持倉</h3>
            {account.positions.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">目前沒有持倉。</p>
            ) : (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      {['標的', '股數', '成本', '最新價', '損益', '停損', ''].map((h) => (
                        <th key={h} className={thClass}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {account.positions.map((p) => {
                      const gain = p.lastPrice / p.avgCost - 1
                      return (
                        <tr key={p.symbol} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                          <td className={tdClass}>
                            {formatSymbol(p.symbol)} {p.name}
                          </td>
                          <td className={tdClass}>{p.shares}</td>
                          <td className={tdClass}>{p.avgCost.toFixed(2)}</td>
                          <td className={tdClass}>
                            {p.lastPrice}
                            <span className="ml-1 text-xs text-gray-400">{p.lastPriceDate}</span>
                          </td>
                          <td className={`${tdClass} ${gain >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'}`}>{pct(gain)}</td>
                          <td className={tdClass}>
                            <input
                              type="number"
                              step="any"
                              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
                              defaultValue={p.stopLoss ?? ''}
                              onBlur={(e) => save(setStopLoss(account, p.symbol, Number(e.target.value) > 0 ? Number(e.target.value) : undefined))}
                            />
                          </td>
                          <td className={tdClass}>
                            <button
                              type="button"
                              className={linkClass}
                              onClick={() => setOrder({ ...order, symbol: p.symbol.split(':')[1], side: 'sell', type: 'market', shares: String(p.shares), reason: '' })}
                            >
                              賣出
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">下單</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={account.market === 'US' ? '代號（美股）' : '代號'}>
                <input className={inputClass} value={order.symbol} onChange={(e) => setOrder({ ...order, symbol: e.target.value })} placeholder={account.market === 'US' ? 'SPY' : '0050'} />
              </Field>
              <Field label="買／賣">
                <select className={inputClass} value={order.side} onChange={(e) => setOrder({ ...order, side: e.target.value as 'buy' | 'sell', type: e.target.value === 'buy' && order.type === 'stop' ? 'market' : order.type })}>
                  <option value="buy">買進</option>
                  <option value="sell">賣出</option>
                </select>
              </Field>
              <Field label="委託">
                <select className={inputClass} value={order.type} onChange={(e) => setOrder({ ...order, type: e.target.value as PaperOrder['type'] })}>
                  <option value="market">市價（最新收盤成交）</option>
                  <option value="limit">限價</option>
                  {order.side === 'sell' && <option value="stop">停損單</option>}
                </select>
              </Field>
              <Field label="股數">
                <input type="number" step="1" className={inputClass} value={order.shares} onChange={(e) => setOrder({ ...order, shares: e.target.value })} />
              </Field>
              {(order.type !== 'market' || account.market === 'US') && (
                <Field label={order.type === 'market' ? '成交價（手動）' : order.type === 'limit' ? '限價' : '觸發價'}>
                  <input type="number" step="any" className={inputClass} value={order.price} onChange={(e) => setOrder({ ...order, price: e.target.value })} />
                </Field>
              )}
              {order.side === 'buy' && (
                <Field label="停損價（建議必填）">
                  <input type="number" step="any" className={inputClass} value={order.stopLoss} onChange={(e) => setOrder({ ...order, stopLoss: e.target.value })} />
                </Field>
              )}
              <Field label="理由">
                <input className={inputClass} value={order.reason} onChange={(e) => setOrder({ ...order, reason: e.target.value })} placeholder="依策略卡的哪條規則" />
              </Field>
              <Field label="當下情緒">
                <select className={inputClass} value={order.emotion} onChange={(e) => setOrder({ ...order, emotion: Number(e.target.value) })}>
                  {EMOTIONS.map((label, i) => (
                    <option key={label} value={i + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={submitForm}
              className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              送出委託
            </button>

            {openOrders.length > 0 && (
              <>
                <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">未成交委託</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {openOrders.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-3 text-gray-700 dark:text-gray-300">
                      {o.side === 'buy' ? '買進' : '賣出'} {formatSymbol(o.symbol)} {o.shares} 股・{o.type === 'limit' ? '限價' : '停損'} {o.price}
                      <span className="text-xs text-gray-400">{o.createdAt.slice(0, 10)}</span>
                      <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => save(cancelOrder(account, o.id))}>
                        取消
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {account.equityHistory.length > 1 && (
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">權益曲線（起始 = 100，對照 0050）</h2>
              <EquityChart data={equityPoints()} oosStart={null} labels={['帳戶', '0050（含息）']} />
            </div>
          )}

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">成交紀錄</h2>
            {filled.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">還沒有成交。</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      {['日期', '買賣', '標的', '股數', '成交價', '損益', 'R', '理由', '情緒'].map((h) => (
                        <th key={h} className={thClass}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filled.map((o) => (
                      <tr key={o.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                        <td className={`${tdClass} text-xs`}>{o.filledAt?.slice(0, 10)}</td>
                        <td className={tdClass}>{o.side === 'buy' ? '買進' : '賣出'}</td>
                        <td className={tdClass}>{formatSymbol(o.symbol)}</td>
                        <td className={tdClass}>{o.shares}</td>
                        <td className={tdClass}>{o.fillPrice}</td>
                        <td className={`${tdClass} ${(o.realizedPnl ?? 0) >= 0 ? '' : 'text-orange-700 dark:text-orange-400'}`}>
                          {o.realizedPnl === undefined ? '' : money(o.realizedPnl)}
                        </td>
                        <td className={tdClass}>{o.rMultiple === undefined ? '' : o.rMultiple.toFixed(1)}</td>
                        <td className={`${tdClass} text-xs`}>{o.reason}</td>
                        <td className={tdClass}>{o.emotion ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex items-center gap-3">
              {pendingDelete ? (
                <>
                  <button
                    type="button"
                    className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                    onClick={() => {
                      removePaperAccount(account.id)
                      setSelectedId(accounts.find((a) => a.id !== account.id)?.id ?? null)
                      setPendingDelete(false)
                    }}
                  >
                    確定刪除這個帳戶
                  </button>
                  <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setPendingDelete(false)}>
                    取消
                  </button>
                </>
              ) : (
                <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setPendingDelete(true)}>
                  刪除帳戶
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
