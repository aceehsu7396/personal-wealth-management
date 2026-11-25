import { useMemo } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { paperOverview, type Market } from '../../lib/paper/overview'
import { formatSymbol } from '../../lib/backtest/templates'
import { StatCard } from '../StatCard'
import type { PaperAccount } from '../../lib/storage/schema'

const cardClass = 'mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const numTh = `${thClass} text-right`
const tdClass = 'py-1.5 pr-3 whitespace-nowrap text-gray-700 dark:text-gray-300'
const numTd = `${tdClass} text-right tabular-nums`
const totalRow = 'border-t border-gray-300 font-semibold dark:border-gray-600'
const CURRENCY: Record<Market, string> = { TW: '新台幣', US: '美元' }

const money = (v: number) => Math.round(v).toLocaleString('zh-TW')
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')
const signed = (v: number) => `${v > 0 ? '+' : ''}${money(v)}`
// Gains and losses in the same tones as the account's holdings table.
const tone = (v: number) => (v > 0.5 ? 'text-indigo-700 dark:text-indigo-400' : v < -0.5 ? 'text-orange-700 dark:text-orange-400' : '')

function Table({ head, children }: { head: { label: string; num?: boolean }[]; children: React.ReactNode }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {head.map((h) => (
              <th key={h.label} className={h.num ? numTh : thClass}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// 虛擬帳戶總覽 (handbook 10 §7): money, holdings and P&L of every account,
// cash in its own section; TW and US are never summed together.
export function PaperOverview({ accounts, onSelect }: { accounts: PaperAccount[]; onSelect: (id: string) => void }) {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const o = useMemo(() => paperOverview(accounts), [accounts])
  const cardName = (id?: string) => strategies.find((s) => s.id === id)?.name ?? '—'
  const latestDate = o.holdings.reduce((d, h) => (h.lastPriceDate > d ? h.lastPriceDate : d), '')
  const multi = o.totals.length > 1
  const label = (m: Market) => (multi ? `${m === 'TW' ? '台股' : '美股'}・` : '')
  const nameButton = (id: string, name: string) => (
    <button type="button" onClick={() => onSelect(id)} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
      {name}
    </button>
  )

  return (
    <>
      {o.totals.map((t) => (
        <div key={t.market} className="mt-6">
          {multi && <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.market === 'TW' ? '台股帳戶（新台幣）' : '美股帳戶（美元）'}</h2>}
          <div className={`${multi ? 'mt-2' : ''} grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`}>
            <StatCard label="總權益" value={money(t.equity)} hint={`${t.accounts} 個帳戶・初始 ${money(t.initialCash)}${multi ? '' : `（${CURRENCY[t.market]}）`}`} />
            <StatCard label="持股市值" value={money(t.holdings)} hint={`占權益 ${pct(1 - t.cashShare)}・未實現 ${signed(t.unrealized)}`} />
            <StatCard label="現金" value={money(t.cash)} hint={`占權益 ${pct(t.cashShare)}${t.pendingBuys > 0 ? `・扣掛單後 ${money(t.available)}` : ''}`} />
            <StatCard label="累計損益" value={signed(t.pnl)} hint={`報酬 ${pct(t.totalReturn)}・已實現 ${signed(t.realized)}`} />
          </div>
        </div>
      ))}

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">各帳戶</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">以最近一次收盤更新的價格計算；點帳戶名稱看明細與下單。</p>
        <Table
          head={[
            { label: '帳戶' },
            { label: '策略卡' },
            { label: '初始資金', num: true },
            { label: '權益', num: true },
            { label: '持股市值', num: true },
            { label: '現金', num: true },
            { label: '未實現', num: true },
            { label: '已實現', num: true },
            { label: '累計報酬', num: true },
          ]}
        >
          {o.accounts.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
              <td className={tdClass}>
                {nameButton(r.id, r.name)}
                {multi && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{r.market === 'TW' ? '台股' : '美股'}</span>}
              </td>
              <td className={`${tdClass} max-w-[10rem] truncate text-xs`} title={cardName(r.strategyId)}>
                {cardName(r.strategyId)}
              </td>
              <td className={numTd}>{money(r.initialCash)}</td>
              <td className={`${numTd} font-medium text-gray-900 dark:text-gray-100`}>{money(r.equity)}</td>
              <td className={numTd}>{money(r.holdings)}</td>
              <td className={numTd}>{money(r.cash)}</td>
              <td className={`${numTd} ${tone(r.unrealized)}`}>{signed(r.unrealized)}</td>
              <td className={`${numTd} ${tone(r.realized)}`}>{signed(r.realized)}</td>
              <td className={`${numTd} ${tone(r.pnl)}`}>{pct(r.totalReturn)}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">持股部位</h2>
        {o.holdings.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">目前沒有任何帳戶持有股票。</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">依市值由大到小；成本含買進手續費。價格日期比其他持股舊的標成灰色，按頁首的按鈕更新。</p>
            <Table
              head={[
                { label: '標的' },
                { label: '帳戶' },
                { label: '股數', num: true },
                { label: '成本', num: true },
                { label: '最新價', num: true },
                { label: '市值', num: true },
                { label: '占帳戶', num: true },
                { label: '未實現損益', num: true },
              ]}
            >
              {o.holdings.map((h) => (
                <tr key={`${h.accountId}|${h.symbol}`} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className={tdClass}>
                    {formatSymbol(h.symbol)} {h.name !== h.symbol && h.name}
                  </td>
                  <td className={`${tdClass} text-xs`}>{nameButton(h.accountId, h.accountName)}</td>
                  <td className={numTd}>{h.shares.toLocaleString('zh-TW')}</td>
                  <td className={numTd}>{h.avgCost.toFixed(2)}</td>
                  <td className={numTd}>
                    {h.lastPrice}
                    <span className={`ml-1 text-xs ${h.lastPriceDate < latestDate ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>{h.lastPriceDate.slice(5)}</span>
                  </td>
                  <td className={numTd}>
                    {money(h.value)}
                    {multi && <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{h.market === 'TW' ? '元' : '美元'}</span>}
                  </td>
                  <td className={numTd}>{pct(h.weight)}</td>
                  <td className={`${numTd} ${tone(h.unrealized)}`}>
                    {signed(h.unrealized)}
                    <span className="ml-1 text-xs">（{pct(h.gain)}）</span>
                  </td>
                </tr>
              ))}
            </Table>
            {o.shared.length > 0 && (
              <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                多個帳戶同時持有：
                {o.shared.map((s) => `${formatSymbol(s.symbol)} ${s.accounts} 個帳戶共 ${s.shares.toLocaleString('zh-TW')} 股、市值 ${money(s.value)}、未實現 ${signed(s.unrealized)}`).join('；')}
              </p>
            )}
          </>
        )}
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">現金部位</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">買進掛單成交前不會扣現金，這裡先扣掉，才是真正還能動用的錢（市價單以最新價估算，未含手續費）。</p>
        <Table
          head={[
            { label: '帳戶' },
            { label: '現金', num: true },
            { label: '占權益', num: true },
            { label: '買進掛單', num: true },
            { label: '可用現金', num: true },
          ]}
        >
          {o.accounts.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700">
              <td className={tdClass}>{nameButton(r.id, r.name)}</td>
              <td className={numTd}>{money(r.cash)}</td>
              <td className={numTd}>{pct(r.cashShare)}</td>
              <td className={numTd}>{r.pendingBuys > 0 ? money(r.pendingBuys) : '—'}</td>
              <td className={`${numTd} ${r.available < 0 ? 'text-orange-700 dark:text-orange-400' : ''}`}>{money(r.available)}</td>
            </tr>
          ))}
          {o.totals.map((t) => (
            <tr key={t.market} className={totalRow}>
              <td className={tdClass}>{label(t.market)}合計</td>
              <td className={numTd}>{money(t.cash)}</td>
              <td className={numTd}>{pct(t.cashShare)}</td>
              <td className={numTd}>{t.pendingBuys > 0 ? money(t.pendingBuys) : '—'}</td>
              <td className={numTd}>{money(t.available)}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  )
}
