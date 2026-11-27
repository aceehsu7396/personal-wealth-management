import { useMemo, useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { paperOverview, type HoldingRow, type Market, type MarketTotal, type StrategyRow } from '../../lib/paper/overview'
import { poolHistory } from '../../lib/paper/fund'
import { paperStats } from '../../lib/paper/paperAccount'
import { paperRulesFor } from '../../lib/calculations/strategyProgress'
import { formatSymbol } from '../../lib/backtest/templates'
import { loadSeries, seriesForBacktest } from '../../lib/market/priceHistory'
import { EquityChart } from '../charts/BacktestCharts'
import { Badge, Card, DataTable, StatTile, type Column } from '../ui'
import { inputClass } from '../forms/FormField'
import type { PaperAccount, PaperFunds } from '../../lib/storage/schema'
import { OPEN_RISK_LIMIT_PERCENT } from '../../lib/paper/assistant'

const UNIT: Record<Market, string> = { TW: '元', US: '美元' }
const MARKET: Record<Market, string> = { TW: '台股', US: '美股' }

const money = (v: number) => Math.round(v).toLocaleString('zh-TW')
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(Math.abs(v))}`
// Up in indigo, down in red (docs/ui-guidelines.md §7); signs carry it too.
const upDown = (v: number) => (v > 0.5 ? 'text-indigo-700 dark:text-indigo-400' : v < -0.5 ? 'text-red-700 dark:text-red-400' : '')
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

// Stock vs cash of a pool, as one bar with its labels.
function SplitBar({ holdings, cash, unit }: { holdings: number; cash: number; unit: string }) {
  const total = holdings + cash
  const stock = total > 0 ? holdings / total : 0
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`持股 ${pct(stock)}、現金 ${pct(1 - stock)}`}>
        {stock > 0 && <div className="bg-indigo-500 dark:bg-indigo-400" style={{ width: `${stock * 100}%` }} />}
        {stock < 1 && <div className="flex-1 bg-gray-300 dark:bg-gray-600" />}
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-indigo-500 dark:bg-indigo-400" />
          持股 {pct(stock)}・{money(holdings)} {unit}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-gray-300 dark:bg-gray-600" />
          現金 {pct(1 - stock)}・{money(cash)} {unit}
        </span>
      </div>
    </div>
  )
}

function conclusion(t: MarketTotal, multi: boolean): string {
  return `${multi ? `${MARKET[t.market]}：` : ''}總權益 ${money(t.equity)} ${UNIT[t.market]}，累計 ${signed(t.pnl)}（${signedPct(t.totalReturn)}）；持股占 ${pct(1 - t.cashShare)}、現金占 ${pct(t.cashShare)}，${t.strategies} 個策略共用。`
}

// The money put into one market's pool; lowering it below what the
// strategies have spent would leave negative cash, so that is refused.
function CapitalEditor({ t }: { t: MarketTotal }) {
  const setPaperCapital = useAppStore((s) => s.setPaperCapital)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(Math.round(t.capital)))
  const next = Number(value)
  const cashAfter = t.cash + next - t.capital
  const error = !(next > 0) ? '請輸入大於 0 的金額' : cashAfter < 0 ? `現金會變成 ${money(cashAfter)}：持股已用掉這麼多，請先賣出或填較大的金額` : null
  if (!editing)
    return (
      <button type="button" className={linkClass} onClick={() => setEditing(true)}>
        調整投入資金
      </button>
    )
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
        投入資金
        <input type="number" step="10000" className={`${inputClass} w-36`} value={value} onChange={(e) => setValue(e.target.value)} />
        {UNIT[t.market]}
      </label>
      <button
        type="button"
        disabled={error !== null}
        className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        onClick={() => {
          setPaperCapital(t.market, next - (t.capital - (useAppStore.getState().paperFunds[t.market]?.capital ?? 0)))
          setEditing(false)
        }}
      >
        儲存
      </button>
      <button type="button" className="text-gray-600 hover:underline dark:text-gray-400" onClick={() => setEditing(false)}>
        取消
      </button>
      {error ? <span className="w-full text-red-700 dark:text-red-400">{error}</span> : <span className="w-full text-gray-500 dark:text-gray-400">現金跟著加減 {signed(next - t.capital)}，持股不變。</span>}
    </div>
  )
}

// The pool's equity against 0050 (when its prices are cached), both at 100.
function poolPoints(accounts: PaperAccount[], market: Market, funds: PaperFunds, capital: number) {
  const history = poolHistory(accounts, market, funds)
  if (history.length < 2 || capital <= 0) return []
  const tw50 = market === 'TW' ? loadSeries('TW:0050') : null
  const bars = tw50 ? seriesForBacktest(tw50).bars : []
  const at = (date: string) => [...bars].reverse().find((b) => b.date <= date)?.close
  const base = at(history[0].date)
  return history.map((p) => ({ date: p.date, strategy: (p.equity / capital) * 100, benchmark: base ? ((at(p.date) ?? base) / base) * 100 : 100 }))
}

// 虛擬帳戶總覽 (handbook 10 §7): each market's cash pool first, then every
// holding with its strategy, then each strategy's profit and progress.
// TW and US are never summed together.
export function PaperOverview({ accounts, funds, today, onSelect }: { accounts: PaperAccount[]; funds: PaperFunds; today: string; onSelect: (id: string) => void }) {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const o = useMemo(() => paperOverview(accounts, funds), [accounts, funds])
  const multi = o.totals.length > 1
  const latestDate = o.holdings.reduce((d, h) => (h.lastPriceDate > d ? h.lastPriceDate : d), '')
  const strategyLink = (id: string, name: string) => (
    <button type="button" onClick={() => onSelect(id)} className="text-left text-indigo-700 hover:underline dark:text-indigo-400">
      {name}
    </button>
  )

  const holdingColumns: Column<HoldingRow>[] = [
    {
      key: 'symbol',
      label: '標的',
      render: (h) => (
        <>
          {formatSymbol(h.symbol)} {h.name !== h.symbol ? h.name : ''}
          <span className="block text-xs text-gray-500 dark:text-gray-400">{h.shares.toLocaleString('zh-TW')} 股</span>
        </>
      ),
      sortValue: (h) => h.symbol,
    },
    { key: 'strategy', label: '策略', render: (h) => <span className="text-xs">{strategyLink(h.accountId, h.accountName)}</span>, sortValue: (h) => h.accountName },
    { key: 'value', label: '市值', numeric: true, render: (h) => money(h.value), sortValue: (h) => h.value },
    { key: 'weight', label: '占總資金', numeric: true, render: (h) => pct(h.weight), sortValue: (h) => h.weight },
    {
      key: 'pnl',
      label: '未實現損益',
      numeric: true,
      render: (h) => (
        <span className={upDown(h.unrealized)}>
          {signed(h.unrealized)}
          <span className="block text-xs">{signedPct(h.gain)}</span>
        </span>
      ),
      sortValue: (h) => h.gain,
    },
    {
      key: 'price',
      label: '成本 → 最新價',
      numeric: true,
      render: (h) => (
        <span className="whitespace-nowrap">
          {h.avgCost.toFixed(2)} → {h.lastPrice}
          <span className={`ml-1 text-xs ${h.lastPriceDate < latestDate ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>{h.lastPriceDate.slice(5)}</span>
        </span>
      ),
    },
    { key: 'stop', label: '停損', numeric: true, render: (h) => (h.stopLoss === undefined ? <span className="text-amber-700 dark:text-amber-400">未設</span> : Math.round(h.stopLoss * 100) / 100), sortValue: (h) => h.stopLoss ?? 0 },
  ]

  const progressOf = (r: StrategyRow) => {
    const account = accounts.find((a) => a.id === r.id)!
    const card = strategies.find((s) => s.id === r.strategyId)
    const rules = paperRulesFor(card)
    const s = paperStats(account, today)
    return { card, text: card ? `${Math.min(s.months, rules.months)}/${rules.months} 月・${Math.min(s.fills, rules.fills)}/${rules.fills} 筆` : '—' }
  }
  const strategyColumns: Column<StrategyRow>[] = [
    {
      key: 'name',
      label: '策略',
      render: (r) => (
        <>
          {strategyLink(r.id, r.name)}
          <span className="block text-xs text-gray-500 dark:text-gray-400">{progressOf(r).card?.name ?? '未連結策略卡'}</span>
        </>
      ),
      sortValue: (r) => r.name,
    },
    { key: 'positions', label: '持股', numeric: true, render: (r) => (r.positions > 0 ? `${r.positions} 檔・${money(r.holdings)}` : '—'), sortValue: (r) => r.holdings },
    { key: 'realized', label: '已實現', numeric: true, render: (r) => <span className={upDown(r.realized)}>{signed(r.realized)}</span>, sortValue: (r) => r.realized },
    { key: 'unrealized', label: '未實現', numeric: true, render: (r) => <span className={upDown(r.unrealized)}>{signed(r.unrealized)}</span>, sortValue: (r) => r.unrealized },
    {
      key: 'pnl',
      label: '累計損益',
      numeric: true,
      render: (r) => (
        <span className={`font-medium ${upDown(r.pnl)}`}>
          {signed(r.pnl)}
          <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">占總資金 {signedPct(r.pnlShare)}</span>
        </span>
      ),
      sortValue: (r) => r.pnl,
    },
    { key: 'progress', label: '4.3 進度', render: (r) => <span className="text-xs">{progressOf(r).text}</span> },
  ]

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">現金池</h2>
        {o.totals.map((t) => (
          <p key={t.market} className="mt-1 text-sm text-gray-800 dark:text-gray-200">
            {conclusion(t, multi)}
          </p>
        ))}
        {o.totals.map((t) => (
          <div key={t.market} className="mt-4">
            {multi && <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{MARKET[t.market]}（{t.market === 'TW' ? '新台幣' : '美元'}）</h3>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="總權益" value={money(t.equity)} hint={`投入 ${money(t.capital)} ${UNIT[t.market]}`} />
              <StatTile label="累計損益" value={<span className={upDown(t.pnl)}>{signed(t.pnl)}</span>} hint={`報酬 ${signedPct(t.totalReturn)}・已實現 ${signed(t.realized)}`} />
              <StatTile label="持股市值" value={money(t.holdings)} hint={`未實現 ${signed(t.unrealized)}`} />
              <StatTile label="可用現金" value={money(t.available)} hint={t.pendingBuys > 0 ? `現金 ${money(t.cash)}，扣買進掛單 ${money(t.pendingBuys)}` : `占權益 ${pct(t.cashShare)}`} />
            </div>
            <div className="mt-3">
              <SplitBar holdings={t.holdings} cash={t.cash} unit={UNIT[t.market]} />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Badge tone={t.openRiskShare * 100 >= OPEN_RISK_LIMIT_PERCENT ? 'bad' : t.openRiskShare * 100 > OPEN_RISK_LIMIT_PERCENT - 1 ? 'warn' : 'info'}>未平倉停損風險 {pct(t.openRiskShare)}</Badge>
              所有持股同時觸及停損時，約虧 {money(t.openRisk)} {UNIT[t.market]}；上限是總資金的 {OPEN_RISK_LIMIT_PERCENT}%，到了就不再開新部位。
              {t.unstopped > 0 && <span className="text-amber-700 dark:text-amber-400">{t.unstopped} 檔沒設停損，未計入。</span>}
            </p>
            <div className="mt-2">
              <CapitalEditor key={t.capital} t={t} />
            </div>
          </div>
        ))}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">所有策略共用同一個現金池：買進從這裡扣錢，賣出的錢回到這裡。以最近一次收盤更新的價格計算；台股、美股分開，不換匯。</p>
      </Card>

      {o.totals.map((t) => {
        const points = poolPoints(accounts, t.market, funds, t.capital)
        return points.length > 1 ? (
          <Card key={`curve${t.market}`} title={`${multi ? `${MARKET[t.market]}・` : ''}總權益曲線（投入 = 100${t.market === 'TW' ? '，對照 0050' : ''}）`} description="調整過投入資金時，曲線以目前的投入資金計算。">
            <EquityChart data={points} oosStart={null} labels={['虛擬交易', t.market === 'TW' ? '0050（含息）' : '投入資金']} />
          </Card>
        ) : null
      })}

      <Card title="持股部位" description="所有策略的持股，依市值由大到小；美股以美元計。成本含買進手續費。價格日期比其他持股舊的標成琥珀色，按頁首的按鈕更新。">
        <DataTable rows={o.holdings} columns={holdingColumns} rowKey={(h) => `${h.accountId}|${h.symbol}`} empty="目前沒有持股，全部是現金。" />
        {o.shared.length > 0 && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            多個策略同時持有：
            {o.shared.map((s) => `${formatSymbol(s.symbol)} ${s.accounts} 個策略共 ${s.shares.toLocaleString('zh-TW')} 股、市值 ${money(s.value)}、未實現 ${signed(s.unrealized)}`).join('；')}
          </p>
        )}
      </Card>

      <Card title="各策略" description="策略沒有自己的資金，只記錄它的持股與損益。點名稱看助手建議、下單與成交紀錄。">
        <DataTable rows={o.strategies} columns={strategyColumns} rowKey={(r) => r.id} />
      </Card>
    </div>
  )
}
