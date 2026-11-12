import { Link } from 'react-router-dom'
import { useDailyScan } from '../../lib/trades/useDailyScan'
import { AdviceList, Card } from '../ui'

const MAX_ITEMS = 8

// "Today's work" at the top of the 今日 page, in discipline order.
export function DailyScan() {
  const { items, loading } = useDailyScan()
  const shown = items.slice(0, MAX_ITEMS)
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
      {items.length > MAX_ITEMS && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">還有 {items.length - MAX_ITEMS} 項，處理完上面的再看。</p>}
    </Card>
  )
}
