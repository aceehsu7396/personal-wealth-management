import { useState } from 'react'
import { BROKER_NOTE, orderTicket, TIF_NOTE } from '../../lib/trades/orderTicket'
import { nextBatch } from '../../lib/trades/batches'
import type { TradePlan } from '../../lib/storage/schema'
import { secondaryButton, textLink } from '../ui'

const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 0 })

// The orders to place at the broker for this plan (handbook 04 §0.2);
// updates as the plan changes. Nothing is sent anywhere.
export function OrderTicket({ plan, discount }: { plan: TradePlan; discount: number }) {
  const [copied, setCopied] = useState<number | 'all' | null>(null)
  const ticket = orderTicket(plan, plan.shares, discount)
  const lines = [...ticket.lines]
  // An open plan with a batch still to buy: its order comes first.
  const i = nextBatch(plan.batches)
  if (plan.status === 'open' && i >= 0) {
    const b = plan.batches[i]
    const draft = orderTicket({ ...plan, status: 'draft', entryPrice: b.price }, b.shares, discount).lines.find((l) => l.when === '進場')
    if (draft) lines.unshift({ when: '進場', text: `第 ${i + 1} 批：${draft.text}` })
  }
  const copy = async (text: string, key: number | 'all') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }
  if (plan.status === 'closed' || plan.status === 'cancelled') return null
  return (
    <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">委託單草稿</p>
        {lines.length > 0 && (
          <button type="button" className={secondaryButton} onClick={() => void copy(lines.map((l) => `${l.when}：${l.text}`).join('\n'), 'all')}>
            {copied === 'all' ? '已複製' : '全部複製'}
          </button>
        )}
      </div>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">填好進場價、停損與股數後產生。</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-sm text-gray-800 dark:text-gray-200">
          {lines.map((l, k) => (
            <li key={k} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{l.when}</span>
              <span className="min-w-0 flex-1">{l.text}</span>
              <button type="button" className={`${textLink} text-xs`} onClick={() => void copy(l.text, k)}>
                {copied === k ? '已複製' : '複製'}
              </button>
            </li>
          ))}
        </ol>
      )}
      {ticket.costs && (
        <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">
          預估成本：買進手續費 {fmt(ticket.costs.buyFee)} 元；停損賣出的手續費加證交稅 {fmt(ticket.costs.stopSellCost)} 元。停損時實際虧損約 {fmt(ticket.costs.lossAtStop)} 元（含成本）。
          {discount === 1 && ' 手續費以牌告計算；有折扣可在投資政策填入。'}
        </p>
      )}
      {ticket.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {ticket.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{TIF_NOTE}</p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{BROKER_NOTE}</p>
    </div>
  )
}
