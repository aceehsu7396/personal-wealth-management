import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDailyScan } from '../../lib/trades/useDailyScan'
import { useRegime } from '../../lib/market/useRegime'
import { todayIsoDate } from '../../lib/market/twse'
import { saveTodaySummary } from '../../lib/push/push'
import { eventMonitorPrompt } from '../../lib/ai/prompts/agents'
import { PromptPanel } from '../ai/PromptPanel'
import { ADVICE_LABELS, AdviceList, Card } from '../ui'

const MAX_ITEMS = 8

// "Today's work" at the top of the 今日 page, in discipline order.
export function DailyScan() {
  const { items, loading } = useDailyScan()
  const { ctx } = useRegime()
  const shown = items.slice(0, MAX_ITEMS)
  const today = todayIsoDate()

  // The push notification reads this count (public/sw.js).
  useEffect(() => {
    if (loading) return
    void saveTodaySummary({ date: today, total: items.length, required: items.filter((i) => i.level === 'required').length, first: items[0]?.text })
  }, [items, loading, today])

  return (
    <Card
      title="今天要處理的事"
      description={loading ? '讀取持倉價格中…' : items.length > 0 ? '依紀律優先順序排列：先處理停損與出場，再看買點。' : undefined}
    >
      <AdviceList
        empty="今天沒有需要處理的事。"
        items={shown.map((i) => ({
          level: i.level,
          basis: i.basis,
          text: (
            <Link to={i.to} className="hover:underline">
              {i.text}
            </Link>
          ),
        }))}
      />
      {items.length > MAX_ITEMS && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">還有 {items.length - MAX_ITEMS} 項，處理完上面的再看。</p>}
      {items.length > 0 && (
        <div className="mt-3">
          <PromptPanel
            amounts
            build={(includeAmounts) =>
              eventMonitorPrompt({
                today,
                includeAmounts,
                regime: ctx ? { label: ctx.label, since: ctx.since, multiplier: ctx.multiplier } : null,
                items: items.map((i) => ({ level: ADVICE_LABELS[i.level], text: i.text, basis: i.basis })),
              })
            }
          />
        </div>
      )}
    </Card>
  )
}
