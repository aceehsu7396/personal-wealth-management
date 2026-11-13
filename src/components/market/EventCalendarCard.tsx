import { useAppStore } from '../../lib/storage/appStore'
import { addDays, EVENT_LABELS, EVENT_RULES, GAP_RISK, useEvents, type MarketEvent } from '../../lib/market/events'
import { todayIsoDate } from '../../lib/market/twse'
import { Badge, Card, DataTable } from '../ui'

// The next two weeks: company events for holdings and open plans first,
// then market-wide dates (handbook 05 §9.1).
export function EventCalendarCard() {
  const today = todayIsoDate()
  const events = useEvents(today)
  const holdings = useAppStore((s) => s.holdings)
  const plans = useAppStore((s) => s.tradePlans)
  const watchlist = useAppStore((s) => s.watchlist)
  const held = new Set([...holdings.filter((h) => h.shares > 0).map((h) => h.ticker), ...plans.filter((p) => p.status !== 'closed' && p.status !== 'cancelled').map((p) => p.ticker)])
  const watched = new Set(watchlist.map((w) => w.symbol.replace(/^TW:/, '')))
  const end = addDays(today, EVENT_RULES.calendarDays)
  const rows = events
    .filter((e) => e.date >= today && e.date <= end && (!e.ticker || held.has(e.ticker) || watched.has(e.ticker)))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(!!b.ticker && held.has(b.ticker)) - Number(!!a.ticker && held.has(a.ticker)))
  return (
    <Card title="事件日曆" description={`未來 ${EVENT_RULES.calendarDays} 天：持股、計畫單與觀察名單的除權息與法說會，以及財報截止日與央行會議。法說會與財報前後可能跳空。`}>
      <DataTable<MarketEvent>
        rows={rows}
        rowKey={(e) => `${e.kind}|${e.ticker ?? ''}|${e.date}`}
        empty="未來兩週沒有相關事件。"
        columns={[
          { key: 'date', label: '日期', render: (e) => e.date.slice(5).replace('-', '/'), sortValue: (e) => e.date },
          { key: 'kind', label: '類型', render: (e) => <Badge tone={GAP_RISK.includes(e.kind) ? 'warn' : 'info'}>{EVENT_LABELS[e.kind]}</Badge> },
          {
            key: 'what',
            label: '內容',
            render: (e) => (
              <span>
                {e.ticker && <span className="font-medium text-gray-900 dark:text-gray-100">{`${e.ticker} ${e.name ?? ''} `}</span>}
                {e.title}
                {e.ticker && held.has(e.ticker) && <span className="ml-2"><Badge tone="good">持有中</Badge></span>}
              </span>
            ),
          },
          { key: 'src', label: '來源', render: (e) => <span className="text-xs text-gray-600 dark:text-gray-400">{e.source}</span> },
        ]}
      />
    </Card>
  )
}
