import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FireProjectionPoint } from '../../lib/calculations/fireProjection'
import { formatCurrency } from '../../lib/format'

interface Props {
  points: FireProjectionPoint[]
  fireNumber: number
  currency: string
}

export function NetWorthProjectionChart({ points, fireNumber, currency }: Props) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.3} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis
            tickFormatter={(v) => formatCurrency(v, currency)}
            tick={{ fontSize: 11, fill: '#64748b' }}
            width={80}
          />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), currency)}
            labelFormatter={(label) => `${label} 年`}
          />
          {Number.isFinite(fireNumber) && (
            <ReferenceLine
              y={fireNumber}
              stroke="#b45309"
              strokeDasharray="4 4"
              label={{
                value: '財務自由目標',
                position: 'insideTopRight',
                fill: '#b45309',
                fontSize: 12,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="projectedNetWorth"
            stroke="#059669"
            strokeWidth={2}
            fill="url(#netWorthFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
