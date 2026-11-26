import { useMemo } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { paperOverview, type AccountRow, type HoldingRow, type Market, type MarketTotal } from '../../lib/paper/overview'
import { formatSymbol } from '../../lib/backtest/templates'
import { Badge, Card, DataTable, StatTile, type Column } from '../ui'
import type { PaperAccount } from '../../lib/storage/schema'

const UNIT: Record<Market, string> = { TW: '元', US: '美元' }
const MARKET: Record<Market, string> = { TW: '台股', US: '美股' }
const TOP_HOLDINGS = 3

const money = (v: number) => Math.round(v).toLocaleString('zh-TW')
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(Math.abs(v))}`
// Up in indigo, down in red (docs/ui-guidelines.md §7); signs carry it too.
const upDown = (v: number) => (v > 0.5 ? 'text-indigo-700 dark:text-indigo-400' : v < -0.5 ? 'text-red-700 dark:text-red-400' : '')
const toneOf = (v: number) => (v > 0.0005 ? 'good' : v < -0.0005 ? 'bad' : 'info') as 'good' | 'bad' | 'info'

// Stock vs cash of an account or a market, as one bar with its labels.
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
  return `${multi ? `${MARKET[t.market]}：` : ''}${t.accounts} 個帳戶，總權益 ${money(t.equity)} ${UNIT[t.market]}，累計 ${signed(t.pnl)}（${signedPct(t.totalReturn)}）；持股占 ${pct(1 - t.cashShare)}、現金占 ${pct(t.cashShare)}。`
}

function AccountCard({ row, holdings, card, onSelect }: { row: AccountRow; holdings: HoldingRow[]; card?: string; onSelect: () => void }) {
  const unit = UNIT[row.market]
  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            <button type="button" onClick={onSelect} className="text-indigo-700 hover:underline dark:text-indigo-400">
              {row.name}
            </button>
          </h3>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{card ? `策略卡：${card}` : '未連結策略卡'}</p>
        </div>
        <Badge tone={toneOf(row.totalReturn)}>{signedPct(row.totalReturn)}</Badge>
      </div>
      <p className="mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {money(row.equity)}
        <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
          {unit}・初始 {money(row.initialCash)}
        </span>
      </p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        未實現 <span className={upDown(row.unrealized)}>{signed(row.unrealized)}</span>・已實現 <span className={upDown(row.realized)}>{signed(row.realized)}</span>
      </p>
      <div className="mt-3">
        <SplitBar holdings={row.holdings} cash={row.cash} unit={unit} />
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {holdings.length === 0 && <li className="text-gray-500 dark:text-gray-400">沒有持股，全部是現金。</li>}
        {holdings.slice(0, TOP_HOLDINGS).map((h) => (
          <li key={h.symbol} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-gray-800 dark:text-gray-200">
              {formatSymbol(h.symbol)} {h.name !== h.symbol && h.name}
            </span>
            <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
              占 {pct(h.weight)}・<span className={upDown(h.unrealized)}>{signedPct(h.gain)}</span>
            </span>
          </li>
        ))}
        {holdings.length > TOP_HOLDINGS && <li className="text-gray-500 dark:text-gray-400">另有 {holdings.length - TOP_HOLDINGS} 檔，見下方持股部位</li>}
      </ul>
      {row.pendingBuys > 0 && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          買進掛單 {money(row.pendingBuys)}，可用現金 {money(row.available)} {unit}
        </p>
      )}
    </div>
  )
}

// 虛擬帳戶總覽 (handbook 10 §7): the conclusion and totals first, then one
// card per account showing where its money is, then holdings and cash.
// TW and US are never summed together.
export function PaperOverview({ accounts, onSelect }: { accounts: PaperAccount[]; onSelect: (id: string) => void }) {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const o = useMemo(() => paperOverview(accounts), [accounts])
  const multi = o.totals.length > 1
  const latestDate = o.holdings.reduce((d, h) => (h.lastPriceDate > d ? h.lastPriceDate : d), '')
  const accountLink = (id: string, name: string) => (
    <button type="button" onClick={() => onSelect(id)} className="text-left text-indigo-700 hover:underline dark:text-indigo-400">
      {name}
    </button>
  )

  const holdingColumns: Column<HoldingRow>[] = [
    { key: 'symbol', label: '標的', render: (h) => `${formatSymbol(h.symbol)} ${h.name !== h.symbol ? h.name : ''}`, sortValue: (h) => h.symbol },
    { key: 'account', label: '帳戶', render: (h) => <span className="text-xs">{accountLink(h.accountId, h.accountName)}</span>, sortValue: (h) => h.accountName },
    { key: 'value', label: '市值', numeric: true, render: (h) => `${money(h.value)}${multi ? ` ${UNIT[h.market]}` : ''}`, sortValue: (h) => h.value },
    { key: 'weight', label: '占帳戶', numeric: true, render: (h) => pct(h.weight), sortValue: (h) => h.weight },
    {
      key: 'pnl',
      label: '未實現損益',
      numeric: true,
      render: (h) => (
        <span className={upDown(h.unrealized)}>
          {signed(h.unrealized)}（{signedPct(h.gain)}）
        </span>
      ),
      sortValue: (h) => h.gain,
    },
    {
      key: 'price',
      label: '成本 → 最新價',
      numeric: true,
      render: (h) => (
        <>
          {h.avgCost.toFixed(2)} → {h.lastPrice}
          <span className={`ml-1 text-xs ${h.lastPriceDate < latestDate ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>{h.lastPriceDate.slice(5)}</span>
        </>
      ),
    },
  ]
  const cashColumns: Column<AccountRow>[] = [
    { key: 'account', label: '帳戶', render: (r) => accountLink(r.id, r.name) },
    { key: 'cash', label: '現金', numeric: true, render: (r) => `${money(r.cash)}${multi ? ` ${UNIT[r.market]}` : ''}`, sortValue: (r) => r.cash },
    { key: 'share', label: '占權益', numeric: true, render: (r) => pct(r.cashShare), sortValue: (r) => r.cashShare },
    { key: 'pending', label: '買進掛單', numeric: true, render: (r) => (r.pendingBuys > 0 ? money(r.pendingBuys) : '—'), sortValue: (r) => r.pendingBuys },
    {
      key: 'available',
      label: '可用現金',
      numeric: true,
      render: (r) => <span className={r.available < 0 ? 'text-red-700 dark:text-red-400' : 'font-medium text-gray-900 dark:text-gray-100'}>{money(r.available)}</span>,
      sortValue: (r) => r.available,
    },
  ]

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">全部帳戶</h2>
        {o.totals.map((t) => (
          <p key={t.market} className="mt-1 text-sm text-gray-800 dark:text-gray-200">
            {conclusion(t, multi)}
          </p>
        ))}
        {o.totals.map((t) => (
          <div key={t.market} className="mt-4">
            {multi && <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{MARKET[t.market]}帳戶（{t.market === 'TW' ? '新台幣' : '美元'}）</h3>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="總權益" value={money(t.equity)} hint={`初始 ${money(t.initialCash)} ${UNIT[t.market]}`} />
              <StatTile label="累計損益" value={<span className={upDown(t.pnl)}>{signed(t.pnl)}</span>} hint={`報酬 ${signedPct(t.totalReturn)}・已實現 ${signed(t.realized)}`} />
              <StatTile label="持股市值" value={money(t.holdings)} hint={`未實現 ${signed(t.unrealized)}`} />
              <StatTile label="可用現金" value={money(t.available)} hint={t.pendingBuys > 0 ? `現金 ${money(t.cash)}，扣買進掛單 ${money(t.pendingBuys)}` : `占權益 ${pct(t.cashShare)}`} />
            </div>
            <div className="mt-3">
              <SplitBar holdings={t.holdings} cash={t.cash} unit={UNIT[t.market]} />
            </div>
          </div>
        ))}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">以最近一次收盤更新的價格計算；台股、美股分開加總，不換匯。</p>
      </Card>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">各帳戶</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">點帳戶名稱看明細與下單。</p>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          {o.accounts.map((r) => (
            <AccountCard
              key={r.id}
              row={r}
              holdings={o.holdings.filter((h) => h.accountId === r.id)}
              card={strategies.find((s) => s.id === r.strategyId)?.name}
              onSelect={() => onSelect(r.id)}
            />
          ))}
        </div>
      </section>

      <Card title="持股部位" description="所有帳戶的持股，依市值由大到小；成本含買進手續費。價格日期比其他持股舊的標成琥珀色，按頁首的按鈕更新。">
        <DataTable rows={o.holdings} columns={holdingColumns} rowKey={(h) => `${h.accountId}|${h.symbol}`} empty="目前沒有任何帳戶持有股票。" />
        {o.shared.length > 0 && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            多個帳戶同時持有：
            {o.shared.map((s) => `${formatSymbol(s.symbol)} ${s.accounts} 個帳戶共 ${s.shares.toLocaleString('zh-TW')} 股、市值 ${money(s.value)}、未實現 ${signed(s.unrealized)}`).join('；')}
          </p>
        )}
      </Card>

      <Card title="現金部位" description="買進掛單成交前不會扣現金，這裡先扣掉，才是真正能動用的錢（市價單以最新價估算，未含手續費）。">
        <DataTable rows={o.accounts} columns={cashColumns} rowKey={(r) => r.id} />
        <ul className="mt-3 space-y-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
          {o.totals.map((t) => (
            <li key={t.market}>
              {multi ? `${MARKET[t.market]}合計` : '合計'}：現金 {money(t.cash)} {UNIT[t.market]}（占權益 {pct(t.cashShare)}）
              {t.pendingBuys > 0 && `，扣買進掛單 ${money(t.pendingBuys)} 後可用 ${money(t.available)}`}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
