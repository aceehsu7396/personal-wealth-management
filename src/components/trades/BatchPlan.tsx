import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { filledPosition, nextBatch, type Batch } from '../../lib/trades/batches'
import { tradeLink } from '../../lib/trades/tradeLink'
import type { TradePlan, TradeReason } from '../../lib/storage/schema'
import { Badge, secondaryButton, textLink } from '../ui'

const fmt = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 }))
const num = (s: string) => (s.trim() === '' ? undefined : Number(s))

// Batches and add-ons of a plan (handbook 08 §2.3). The first batch is the
// plan's own entry; later ones are recorded one at a time from here.
export function BatchPlan({ plan }: { plan: TradePlan }) {
  const update = useAppStore((s) => s.updateTradePlan)
  const [price, setPrice] = useState('')
  const [shares, setShares] = useState('')
  const draft = plan.status === 'draft'
  const done = plan.status === 'closed' || plan.status === 'cancelled'
  const batches = plan.batches
  const next = nextBatch(batches)
  const pos = filledPosition(batches)
  const setBatches = (b: Batch[]) => update(plan.id, { batches: b })

  const reasonFor = (i: number): TradeReason => (plan.source === 'strategy' ? 'strategy_entry' : (['tranche_1', 'tranche_2', 'tranche_3'] as const)[Math.min(i, 2)])
  const recordLink = (i: number) =>
    tradeLink({ ticker: plan.ticker, side: 'buy', reason: reasonFor(i), planId: plan.id, thesisId: plan.thesisId, strategyId: plan.strategyId, shares: batches[i].shares, price: batches[i].price, stopLoss: plan.currentStop ?? plan.stopLoss })

  const add = (kind: Batch['kind']) => {
    const p = num(price)
    const n = num(shares)
    if (!p || !n || p <= 0 || n <= 0) return
    // A plan without batches gets its own entry as the first one.
    const base: Batch[] = batches.length > 0 ? batches : [{ kind: 'batch', price: plan.entryPrice ?? p, shares: plan.shares ?? 0, addedAt: plan.createdAt, ...(plan.status === 'open' ? { filledAt: plan.openedAt ?? plan.createdAt, fillPrice: plan.fillPrice, fillShares: plan.shares } : {}) }]
    setBatches([...base, { kind, price: p, shares: n, addedAt: new Date().toISOString() }])
    setPrice('')
    setShares('')
  }

  return (
    <div className="space-y-2">
      {batches.length === 0 ? (
        <p className="text-xs text-gray-600 dark:text-gray-400">一次進場。要分批或之後加碼，可以在下面加一批。</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                {['批次', '價位', '股數', '狀態', ''].map((h) => (
                  <th key={h} className="py-1 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    第 {i + 1} 批{b.kind === 'add' && <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">加碼</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(b.price)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(b.filledAt ? (b.fillShares ?? b.shares) : i === 0 && draft ? plan.shares : b.shares)}</td>
                  <td className="py-1.5 pr-3">
                    {b.filledAt ? <Badge tone="good">{`${b.filledAt.slice(5, 10).replace('-', '/')} 成交 ${fmt(b.fillPrice)}`}</Badge> : <span className="text-xs text-gray-600 dark:text-gray-400">待成交</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    {plan.status === 'open' && i === next && (
                      <Link to={recordLink(i)} className={`${textLink} text-xs`}>
                        記錄這一批成交
                      </Link>
                    )}
                    {!b.filledAt && !done && i > 0 && (
                      <button type="button" className="ml-3 text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => setBatches(batches.filter((_, k) => k !== i))}>
                        移除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pos.shares > 0 && (
            <p className="text-xs text-gray-700 dark:text-gray-300">
              已成交 {batches.filter((b) => b.filledAt).length}／{batches.length} 批，共 {fmt(pos.shares)} 股，平均成本 {fmt(pos.avg ?? undefined)}。
            </p>
          )}
          {draft && <p className="text-xs text-gray-600 dark:text-gray-400">第 1 批的股數就是上面「部位」的股數；第 2 批以後在成交後從這裡記錄。</p>}
        </>
      )}
      {!done && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-700 dark:text-gray-300">
            價位
            <input type="number" step="0.01" aria-label="新批次價位" className="ml-1 w-24 rounded border border-gray-300 px-1 py-0.5 text-sm dark:border-gray-600 dark:bg-gray-800" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="text-xs text-gray-700 dark:text-gray-300">
            股數
            <input type="number" step="1" aria-label="新批次股數" className="ml-1 w-20 rounded border border-gray-300 px-1 py-0.5 text-sm dark:border-gray-600 dark:bg-gray-800" value={shares} onChange={(e) => setShares(e.target.value)} />
          </label>
          <button type="button" className={secondaryButton} onClick={() => add(draft ? 'batch' : 'add')}>
            {draft ? '加一批' : '加一筆加碼'}
          </button>
        </div>
      )}
    </div>
  )
}
