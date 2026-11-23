import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { groupCards, symbolNames } from '../lib/backtest/cardGroups'
import {
  cancelOrder,
  paperStats,
  placeOrder,
  setStopLoss,
  type NewOrder,
  type Quote,
} from '../lib/paper/paperAccount'
import { STRATEGY_TEMPLATES, formatSymbol, parseSymbolList } from '../lib/backtest/templates'
import { liveGate, paperRulesFor } from '../lib/calculations/strategyProgress'
import { cadenceOf, DEFAULT_DECISION_DAY, WEEKDAY_LABELS } from '../lib/backtest/weekly'
import { orderChecks, resolveItem } from '../lib/paper/assistant'
import { adviseAccount, fetchQuotes, priceSymbols, routineAccounts, runPaperRoutine, type RoutineProgress } from '../lib/paper/routine'
import { RoutineProgressPanel } from '../components/paper/RoutineProgressPanel'
import { AutoRanNote } from '../components/paper/AutoPaperRoutine'
import { claimRoutine, releaseRoutine } from '../lib/paper/autoRoutine'
import { useJourney } from '../lib/useJourney'
import { useRegime } from '../lib/market/useRegime'
import { OrderCheckList, PaperAssistant } from '../components/paper/PaperAssistant'
import { loadSeries, seriesForBacktest } from '../lib/market/priceHistory'
import { todayIsoDate } from '../lib/market/twse'
import { describeAiError } from '../lib/ai/client'
import { EquityChart } from '../components/charts/BacktestCharts'
import { StatCard } from '../components/StatCard'
import { SimGuide } from '../components/SimGuide'
import { PaperHowTo } from '../components/PaperHowTo'
import { Field, inputClass } from '../components/forms/FormField'
import { PageHeader, primaryButton, secondaryButton } from '../components/ui'
import type { AssistantItem, PaperAccount, PaperOrder } from '../lib/storage/schema'

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

// The latest close of every symbol the account follows, linked card or
// not: what the day's update fetched (handbook 10 §7).
function LatestCloses({ account, symbols, today }: { account: PaperAccount; symbols: string[]; today: string }) {
  if (symbols.length === 0) return null
  const name = (s: string) => account.positions.find((p) => p.symbol === s)?.name ?? ''
  const role = (s: string) =>
    account.positions.some((p) => p.symbol === s) ? '持倉' : account.orders.some((o) => o.status === 'open' && o.symbol === s) ? '掛單' : '策略卡標的'
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">最新收盤價</h3>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {['標的', '收盤價', '資料日期', ''].map((h) => (
                <th key={h} className={thClass}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => {
              const q = account.quotes?.[s]
              const old = q ? Math.floor((Date.parse(today) - Date.parse(q.date)) / 86400000) > 3 : false
              return (
                <tr key={s} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className={tdClass}>
                    {formatSymbol(s)} {name(s)}
                  </td>
                  <td className={tdClass}>{q ? q.price.toLocaleString('zh-TW') : '—'}</td>
                  <td className={`${tdClass} ${old ? 'text-amber-700 dark:text-amber-400' : ''}`}>{q ? `${q.date}${old ? '（較舊）' : ''}` : '尚未更新'}</td>
                  <td className={`${tdClass} text-xs text-gray-500 dark:text-gray-400`}>{role(s)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// The stock first, then only the cards made for it.
function CreateAccount({ defaultStrategyId, onCreate }: { defaultStrategyId: string; onCreate: (a: Omit<PaperAccount, 'id' | 'createdAt'>) => void }) {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const watchlist = useAppStore((s) => s.watchlist)
  const stockTheses = useAppStore((s) => s.stockTheses)
  const paperAccounts = useAppStore((s) => s.paperAccounts)
  const holdings = useAppStore((s) => s.holdings)
  const names = useMemo(() => symbolNames({ watchlist, stockTheses, paperAccounts, holdings }), [watchlist, stockTheses, paperAccounts, holdings])
  const groups = groupCards(
    strategies.filter((s) => s.status !== 'retired'),
    'symbol',
    { runs: [], accounts: [], names },
  )
  const groupOf = (id: string) => groups.find((g) => g.cards.some((c) => c.id === id))?.key ?? ''
  const [name, setName] = useState('')
  const [stock, setStock] = useState(() => groupOf(defaultStrategyId))
  const cards = groups.find((g) => g.key === stock)?.cards ?? []
  const marketOf = (key: string) => (key.split(',').every((x) => x.startsWith('US:')) && key ? 'US' : 'TW')
  const [market, setMarket] = useState<'TW' | 'US'>(() => marketOf(stock))
  const [cash, setCash] = useState(1_000_000)
  const [strategyId, setStrategyId] = useState(defaultStrategyId)
  const strategy = strategies.find((s) => s.id === strategyId)

  function chooseStock(key: string) {
    setStock(key)
    const list = groups.find((g) => g.key === key)?.cards ?? []
    // One card: link it; several: let the user pick.
    setStrategyId(list.length === 1 ? list[0].id : '')
    if (key) setMarket(marketOf(key))
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="帳戶名稱">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={strategy?.name ?? '例：0050 均線練習'} />
      </Field>
      <Field label="標的">
        <select className={inputClass} value={stock} onChange={(e) => chooseStock(e.target.value)}>
          <option value="">（不指定）</option>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}（{g.cards.length} 張策略卡）
            </option>
          ))}
        </select>
      </Field>
      <Field label="連結策略卡">
        <select className={inputClass} value={strategyId} onChange={(e) => setStrategyId(e.target.value)} disabled={!stock}>
          <option value="">{stock ? '（不連結）' : '先選標的'}</option>
          {cards.map((s) => (
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
      <div className="col-span-full">
        <button
          type="button"
          disabled={!(cash > 0)}
          onClick={() =>
            onCreate({
              name: name.trim() || (strategy ? `${strategy.name}・虛擬` : '虛擬帳戶'),
              strategyId: strategyId || undefined,
              market,
              initialCash: cash,
              cash,
              positions: [],
              orders: [],
              equityHistory: [],
              signalLog: [],
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
  const setPaperRoutineRanAt = useAppStore((s) => s.setPaperRoutineRanAt)

  const presetStrategy = search.get('strategy') ?? ''
  const preset = accounts.find((a) => a.id === search.get('account')) ?? accounts.find((a) => a.strategyId === presetStrategy)
  const [selectedId, setSelectedId] = useState<string | null>(preset?.id ?? accounts[0]?.id ?? null)
  const [creating, setCreating] = useState(accounts.length === 0 || (presetStrategy !== '' && !preset))
  const [busy, setBusy] = useState<string | null>(null)
  // The last 更新收盤價並產生建議: progress while it runs, then its summary.
  const [progress, setProgress] = useState<RoutineProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Symbols the last update could not get a close for.
  const [missing, setMissing] = useState<string[]>([])
  const [manualPrices, setManualPrices] = useState<Record<string, string>>({})
  const [order, setOrder] = useState({ symbol: '', side: 'buy' as 'buy' | 'sell', type: 'market' as PaperOrder['type'], shares: '', price: '', stopLoss: '', reason: '', emotion: 3 })
  const [pendingDelete, setPendingDelete] = useState(false)

  const { policy } = useJourney()
  const { ctx: regime, loading: regimeLoading } = useRegime()
  const today = todayIsoDate()
  const account = accounts.find((a) => a.id === selectedId)
  const strategy = strategies.find((s) => s.id === account?.strategyId)
  const weeklyDecisionDay = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay)
  // Weekly cards decide at the decision day's close and fill at the next
  // open, as in the backtest (handbook 10 §6.6).
  const weekly = !!strategy && cadenceOf(strategy.template, strategy.cadence) === 'weekly'
  const decisionDay = strategy?.decisionDay ?? weeklyDecisionDay ?? DEFAULT_DECISION_DAY
  const rules = paperRulesFor(strategy)
  const current = () => useAppStore.getState().paperAccounts.find((a) => a.id === account?.id)!

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

  // The day's one step: the latest closes for every account, whatever its
  // card (positions, open orders and the card's symbols; fills orders and
  // triggers stops), then the suggestions: for every account on a paper
  // card, and for this one whenever its card has rules.
  async function updateAndAdvise() {
    if (!account) return
    // The automatic run after the close may be under way.
    if (!claimRoutine()) return setError('收盤後的自動更新正在進行中，完成後就會看到結果。')
    setProgress(null)
    await guarded('更新收盤價…', async () => {
      const res = await runPaperRoutine({
        accounts,
        strategies,
        policy,
        regime,
        today,
        onStep: setBusy,
        weeklyDecisionDay,
        manual: manualQuotes(priceSymbols(account, strategy)),
        latest: (id) => useAppStore.getState().paperAccounts.find((a) => a.id === id)!,
        save: replacePaperAccount,
        onProgress: setProgress,
      })
      setMissing(res.missing)
      if (res.failed.length > 0) throw new Error(res.failed.map((f) => `${f.name}：${describeAiError(f.error)}`).join('；'))
      if (canSignal && strategy && !routineAccounts([current()], strategies).length) {
        // This account's card is not in paper trading: its suggestions too.
        const mark = (status: 'advising' | 'done' | 'failed', phase: RoutineProgress['phase'], note?: string) =>
          setProgress((p) => p && { ...p, phase, accounts: p.accounts.map((a) => (a.id === account.id ? { ...a, status, ...(note ? { note } : {}) } : a)) })
        mark('advising', 'advice')
        setBusy(weekly ? '計算本週建議…' : '計算今日建議…')
        try {
          save(await adviseAccount({ account: current(), strategy, policy, regime, today, onStep: setBusy, weeklyDecisionDay }))
          mark('done', 'finished')
        } catch (e) {
          mark('failed', 'finished', describeAiError(e))
          throw e
        }
      }
      setPaperRoutineRanAt(new Date().toISOString())
    })
    releaseRoutine()
  }

  // Places an order on the latest saved account; the caller saves it.
  async function execOrder(input: NewOrder): Promise<PaperAccount> {
    if (!account) throw new Error('沒有選取帳戶')
    {
      let quote: Quote | undefined
      if (input.type === 'market' && input.fillAt !== 'open') {
        // A US price typed in (the order form, or the field above) wins;
        // otherwise the latest close.
        const typed = Number(order.price) || Number(manualPrices[input.symbol])
        if (account.market === 'US' && typed > 0) quote = { price: typed, date: today }
        else quote = (await fetchQuotes([input.symbol], today, setBusy))[input.symbol]
        if (!quote) throw new Error('取不到最新收盤價：請確認代號，美股可在上方手動填價')
      }
      return placeOrder(current(), input, quote)
    }
  }

  async function submitOrder(input: NewOrder) {
    await guarded('下單中…', async () => save(await execOrder(input)))
  }

  // An order as the assistant suggested, or with other shares or stop.
  async function followItem(item: AssistantItem, shares: number, stopLoss: number | undefined) {
    const modified = item.side === 'buy' && (shares !== item.shares || stopLoss !== item.stopLoss)
    await guarded('下單中…', async () => {
      const next = await execOrder({
        symbol: item.symbol,
        name: account?.positions.find((p) => p.symbol === item.symbol)?.name ?? '',
        side: item.side ?? 'buy',
        type: 'market',
        ...(weekly ? { fillAt: 'open' as const } : {}),
        shares,
        stopLoss: item.side === 'buy' ? stopLoss : undefined,
        reason: `策略訊號：${item.reading}${modified ? '（修改股數或停損）' : ''}`,
      })
      save(resolveItem(next, item.symbol, item.kind, modified ? 'modified' : 'followed'))
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
  // The day's one main action: strategy signals when the linked card can
  // produce them, otherwise a price update.
  const canSignal = !!strategy && STRATEGY_TEMPLATES[strategy.template].backtestable
  const backtestPassed = !!strategy && liveGate(strategy, runs, accounts, today).backtestPassed
  // The manual order's checks, on the latest known price of that symbol.
  const formSymbol = account ? parseSymbolList(account.market === 'US' ? `US:${order.symbol.replace(/^US:/i, '')}` : order.symbol)[0] : undefined
  const known = formSymbol ? (account?.assistant?.items.find((i) => i.symbol === formSymbol) ?? account?.positions.find((p) => p.symbol === formSymbol)) : undefined
  const knownPrice = known ? ('close' in known ? { price: known.close, date: known.date } : { price: known.lastPrice, date: known.lastPriceDate }) : null
  const formChecks =
    account && knownPrice && Number(order.shares) > 0
      ? orderChecks({
          side: order.side,
          price: order.type === 'market' ? knownPrice.price : Number(order.price) || knownPrice.price,
          shares: Number(order.shares),
          stopLoss: Number(order.stopLoss) > 0 ? Number(order.stopLoss) : undefined,
          date: knownPrice.date,
          today,
          account,
          policy,
          strategy,
          backtestPassed,
          regime,
        })
      : null
  const showAccount = !!account && !!stats && !creating

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader
        title="虛擬帳戶"
        summary={
          <>
            用虛擬資金照策略卡下單，成本與回測相同。連結策略卡的帳戶操作滿 {rules.months} 個月、{rules.fills} 筆成交{weekly ? `（週頻卡，每週${WEEKDAY_LABELS[decisionDay].slice(1)}收盤判斷、下個交易日開盤成交）` : ''}，就完成行動路線 4.3。說明見手冊{' '}
            <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              10 §7
            </Link>
            。
          </>
        }
        action={
          showAccount ? (
            <div className="flex flex-col items-end gap-1">
              <button type="button" disabled={busy !== null || (canSignal && regimeLoading)} onClick={() => void updateAndAdvise()} className={primaryButton}>
                {canSignal ? '更新收盤價並產生建議' : '更新收盤價'}
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                收盤後自動執行
                <AutoRanNote />
              </span>
            </div>
          ) : undefined
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setSelectedId(a.id)
              setCreating(false)
            }}
            aria-pressed={a.id === selectedId && !creating}
            className={`rounded-md px-3 py-1.5 text-sm ${a.id === selectedId && !creating ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700'}`}
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
      {missing.length > 0 && (
        <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
          {missing.length} 檔取不到收盤價：{missing.map(formatSymbol).join('、')}。證交所與 FinMind 都沒有資料，可能是代號有誤、停牌或剛上市；FinMind 免費額度用完時，約 10 分鐘後再試。
        </p>
      )}
      {progress && <RoutineProgressPanel progress={progress} detail={busy} />}
      {busy && (!progress || progress.phase === 'finished') && <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">{busy}</p>}

      {showAccount && account && stats && (
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
              value={`${Math.min(stats.months, rules.months)}/${rules.months} 月`}
              hint={`${Math.min(stats.fills, rules.fills)}/${rules.fills} 筆成交${account.strategyId ? '' : '（需連結策略卡）'}`}
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
            <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
              {canSignal && weekly
                ? `交易日 14:30 收盤資料公布後，打開網站就會自動執行「更新收盤價並產生建議」（也可以按頁首的按鈕重跑）：一次完成最新收盤價、停損與掛單觸發，以及助手建議。週頻卡只在每週${WEEKDAY_LABELS[decisionDay].slice(1)}收盤判斷進出場，其他日子只檢查停損；下單在下個交易日開盤成交。`
                : canSignal
                  ? '交易日 14:30 收盤資料公布後，打開網站就會自動執行「更新收盤價並產生建議」（也可以按頁首的按鈕重跑）：一次完成最新收盤價、停損與掛單觸發，以及助手建議。'
                  : `交易日 14:30 後打開網站會自動更新收盤價（也可以按頁首的「更新收盤價」重跑）：取得持倉、掛單${strategy ? '與策略卡標的' : ''}的最新收盤價，並觸發停損與限價單。${strategy ? '這張策略卡是文字規則，助手無法自動判斷，請對照下方收盤價自行檢查。' : ''}`}
            </p>

            {account.market === 'US' && (
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {priceSymbols(account, strategy).map((s) => (
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

            <LatestCloses account={account} symbols={priceSymbols(account, strategy)} today={today} />

            {canSignal && strategy && (
              <PaperAssistant
                account={account}
                strategy={strategy}
                backtestPassed={backtestPassed}
                regime={regime}
                policy={policy}
                today={today}
                busy={busy !== null}
                onOrder={(item, shares, stop) => void followItem(item, shares, stop)}
                onRaise={(item) => item.raiseTo !== undefined && save(resolveItem(setStopLoss(current(), item.symbol, item.raiseTo), item.symbol, item.kind, 'followed'))}
                onSkip={(item, note) => save(resolveItem(current(), item.symbol, item.kind, 'skipped', note))}
              />
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
                            <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{p.lastPriceDate}</span>
                          </td>
                          <td className={`${tdClass} ${gain >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'}`}>{pct(gain)}</td>
                          <td className={tdClass}>
                            <input
                              key={p.stopLoss ?? 'none'}
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
            {formChecks && <OrderCheckList checks={formChecks} />}
            <button
              type="button"
              disabled={busy !== null}
              onClick={submitForm}
              className={`mt-3 ${secondaryButton}`}
            >
              送出委託
            </button>

            {openOrders.length > 0 && (
              <>
                <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">未成交委託</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {openOrders.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-3 text-gray-700 dark:text-gray-300">
                      {o.side === 'buy' ? '買進' : '賣出'} {formatSymbol(o.symbol)} {o.shares} 股・{o.type === 'market' ? '市價，下個交易日開盤成交' : o.type === 'limit' ? '限價' : '停損'} {o.price}
                      <span className="text-xs text-gray-500 dark:text-gray-400">{o.createdAt.slice(0, 10)}</span>
                      <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => save(cancelOrder(account, o.id))}>
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
                  <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => setPendingDelete(false)}>
                    取消
                  </button>
                </>
              ) : (
                <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => setPendingDelete(true)}>
                  刪除帳戶
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <SimGuide />
      <PaperHowTo market={account?.market} />
    </div>
  )
}
