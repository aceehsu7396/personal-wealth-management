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
              <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.3} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#6b7280' }} />
          <YAxis
            tickFormatter={(v) => formatCurrency(v, currency)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={80}
          />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), currency)}
            labelFormatter={(label) => `${label} 年`}
          />
          {Number.isFinite(fireNumber) && (
            <ReferenceLine
              y={fireNumber}
              stroke="#ea580c"
              strokeDasharray="4 4"
              label={{
                value: '財務自由目標',
                position: 'insideTopRight',
                fill: '#ea580c',
                fontSize: 12,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="projectedNetWorth"
            stroke="#4f46e5"
            strokeWidth={2}
            fill="url(#netWorthFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
