import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyClose } from '../../lib/storage/schema'

interface Props {
  data: DailyClose[]
  label: string
  color: string
  gradientId: string
}

const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 })

export function MarketPriceChart({ data, label, color, gradientId }: Props) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        尚無{label}收盤價資料
      </p>
    )
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {numberFormat.format(latest.close)}
          <span className="ml-1 text-xs font-normal text-slate-400">{latest.date}</span>
        </span>
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sorted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.3} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v: string) => v.slice(5)}
              minTickGap={30}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v) => numberFormat.format(v)}
              width={64}
            />
            <Tooltip formatter={(value) => numberFormat.format(Number(value))} />
            <Area
              type="monotone"
              dataKey="close"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
