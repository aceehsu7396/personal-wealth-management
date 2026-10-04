import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FireProjectionPoint } from '../../lib/calculations/fireProjection'
import type { NetWorthCheckIn } from '../../lib/storage/schema'
import { formatCurrency } from '../../lib/format'

interface SeriesPoint {
  x: number
  y: number
}

interface Props {
  projectedPoints: FireProjectionPoint[]
  checkIns: NetWorthCheckIn[]
  currency: string
}

function tickDateFormatter(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'short' }).format(
    new Date(timestamp),
  )
}

export function ActualVsProjectedChart({ projectedPoints, checkIns, currency }: Props) {
  const today = Date.now()

  const projectedSeries: SeriesPoint[] = projectedPoints.map((p) => {
    const date = new Date()
    date.setMonth(date.getMonth() + p.monthIndex)
    return { x: date.getTime(), y: p.projectedNetWorth }
  })

  const actualSeries: SeriesPoint[] = [...checkIns]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => ({ x: new Date(c.date).getTime(), y: c.netWorthAmount }))

  if (actualSeries.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        還沒有任何淨值紀錄，新增第一筆之後這裡會出現實際與試算對比圖。
      </p>
    )
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.3} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={tickDateFormatter}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            allowDuplicatedCategory={false}
          />
          <YAxis
            dataKey="y"
            tickFormatter={(v) => formatCurrency(v, currency)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={80}
          />
          <Tooltip
            labelFormatter={(label) => tickDateFormatter(Number(label))}
            formatter={(value) => formatCurrency(Number(value), currency)}
          />
          <ReferenceLine
            x={today}
            stroke="#9ca3af"
            strokeDasharray="2 2"
            label={{ value: '今日', position: 'insideTopLeft', fontSize: 11, fill: '#6b7280' }}
          />
          <Line
            data={projectedSeries}
            dataKey="y"
            name="試算軌跡"
            stroke="#4f46e5"
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            data={actualSeries}
            dataKey="y"
            name="實際淨值"
            stroke="#ea580c"
            strokeWidth={2}
            dot={{ r: 4 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
