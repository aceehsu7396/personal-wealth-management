import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { useOpenPlanStatus, type OpenPlanStatus } from '../../lib/trades/useOpenPlanStatus'
import type { PositionFlag } from '../../lib/trades/tradePlan'
import { tradeLink } from '../../lib/trades/tradeLink'
import { Badge, Card, DataTable, textLink, type Tone } from '../ui'

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: 2 }))

const FLAG: Record<PositionFlag, { label: string; tone: Tone }> = {
  stop_hit: { label: '停損觸發', tone: 'bad' },
  near_stop: { label: '接近停損', tone: 'warn' },
  target_hit: { label: '到達停利', tone: 'good' },
  time_stop: { label: '時間停損到期', tone: 'warn' },
  raise_stop: { label: '停損可上移', tone: 'info' },
  ok: { label: '照計畫持有', tone: 'info' },
}

const STOP_METHOD: Record<string, string> = { structure: '結構', atr: 'ATR', percent: '百分比', manual: '手動' }

// One exit link per row: a stop hit sells everything; a target sells its share.
function exitLink({ plan, status }: OpenPlanStatus): { label: string; to: string } | null {
  if (!status) return null
  const stopHit = status.flags.includes('stop_hit')
  const target = status.flags.includes('target_hit') ? status.reachedTarget : null
  if (!stopHit && !target && !status.flags.includes('time_stop')) return null
  const shares = plan.shares ?? 0
  const sell = stopHit || !target ? shares : Math.max(1, Math.floor(shares * target.fraction))
  const reason = stopHit ? 'stop_loss' : plan.source === 'strategy' ? 'strategy_exit' : 'exit_overvalued'
  return {
    label: stopHit ? '記錄停損出場' : target ? '記錄停利出場' : '記錄時間停損出場',
    to: tradeLink({ ticker: plan.ticker, side: 'sell', reason, planId: plan.id, thesisId: plan.thesisId, strategyId: plan.strategyId, shares: sell, price: status.close }),
  }
}

// Open trade plans while the position is held (handbook 04 §0): the stop
// in force, R, the next target, the time stop, and what to do about them.
export function ExitManager() {
  const { items, loading } = useOpenPlanStatus()
  const updateTradePlan = useAppStore((s) => s.updateTradePlan)
  if (items.length === 0) {
    return (
      <Card title="出場管理" description="依交易計畫單管理持倉的停損、停利與時間停損。">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          還沒有進行中的計畫單。從研究卡或策略卡「建立計畫單」，記錄成交後就會出現在這裡。{' '}
          <Link to="/portfolio/plans" className={textLink}>
            前往交易計畫
          </Link>
        </p>
      </Card>
    )
  }
  return (
    <Card
      title="出場管理"
      description={`進行中的計畫單 ${items.length} 筆。停損只能往上移；觸發時依計畫出場。${loading ? '讀取價格中…' : ''}`}
      action={
        <Link to="/portfolio/plans" className={textLink}>
          全部計畫單
        </Link>
      }
    >
      <DataTable
        rows={items}
        rowKey={(r) => r.plan.id}
        columns={[
          {
            key: 'ticker',
            label: '標的',
            render: ({ plan }) => (
              <span>
                <Link to={`/portfolio/plans?id=${plan.id}`} className="font-medium text-gray-900 hover:underline dark:text-gray-100">
                  {plan.ticker} {plan.name}
                </Link>
                {plan.batches.length > 1 && (
                  <span className="block text-xs text-gray-600 dark:text-gray-400">
                    已成交 {plan.batches.filter((b) => b.filledAt).length}／{plan.batches.length} 批
                  </span>
                )}
              </span>
            ),
            sortValue: ({ plan }) => plan.ticker,
          },
          { key: 'close', label: '收盤', numeric: true, render: ({ status, degraded }) => <span title={degraded ? '用持股的最新價格' : status?.date}>{fmt(status?.close)}</span>, sortValue: ({ status }) => status?.close },
          {
            key: 'stop',
            label: '停損',
            numeric: true,
            render: ({ plan, status }) => `${fmt(status?.stop)}（${STOP_METHOD[plan.stopMethod] ?? ''}）`,
          },
          { key: 'r', label: 'R 倍數', numeric: true, render: ({ status }) => (status?.rMultiple === null || !status ? '—' : `${status.rMultiple > 0 ? '+' : ''}${status.rMultiple.toFixed(1)}R`), sortValue: ({ status }) => status?.rMultiple },
          { key: 'target', label: '下一個停利', numeric: true, render: ({ status }) => fmt(status?.nextTarget?.price) },
          { key: 'time', label: '時間停損', numeric: true, render: ({ status }) => (status?.timeStopLeft === null || !status ? '—' : `剩 ${status.timeStopLeft} 天`) },
          {
            key: 'flags',
            label: '狀態',
            render: ({ status }) => (
              <span className="flex flex-wrap gap-1">
                {(status?.flags ?? ['ok']).map((f) => (
                  <Badge key={f} tone={FLAG[f].tone}>
                    {FLAG[f].label}
                  </Badge>
                ))}
              </span>
            ),
          },
          {
            key: 'action',
            label: '動作',
            render: (item) => {
              const exit = exitLink(item)
              if (exit) {
                return (
                  <Link to={exit.to} className={textLink}>
                    {exit.label}
                  </Link>
                )
              }
              const up = item.status?.raiseTo
              return up ? (
                <button type="button" onClick={() => updateTradePlan(item.plan.id, { currentStop: up })} className={textLink}>
                  採納：停損上移到 {fmt(up)}
                </button>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
              )
            },
          },
        ]}
      />
    </Card>
  )
}
