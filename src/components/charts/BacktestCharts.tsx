import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface EquityPoint {
  date: string
  strategy: number
  benchmark: number
}

const tick = { fontSize: 11, fill: '#6b7280' }
const grid = <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.3} />
const STRATEGY_COLOR = '#4f46e5'
const BENCHMARK_COLOR = '#f97316'

// Growth of 100 for the strategy and buy-and-hold; the dashed line marks
// where the out-of-sample period starts.
export function EquityChart({ data, oosStart }: { data: EquityPoint[]; oosStart: string | null }) {
  // The curve is weekly; mark the first plotted point inside the held-out period.
  const marker = oosStart ? data.find((p) => p.date >= oosStart)?.date : undefined
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          {grid}
          <XAxis dataKey="date" tick={tick} tickFormatter={(v: string) => v.slice(0, 7)} minTickGap={40} />
          <YAxis tick={tick} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} />
          <Tooltip formatter={(v) => Number(v).toFixed(1)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {marker && <ReferenceLine x={marker} stroke="#6b7280" strokeDasharray="4 4" label={{ value: '樣本外', fontSize: 11, fill: '#6b7280' }} />}
          <Line type="monotone" dataKey="strategy" name="策略" stroke={STRATEGY_COLOR} dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="monotone" dataKey="benchmark" name="買進持有" stroke={BENCHMARK_COLOR} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// Drawdown from the running peak, in percent.
export function DrawdownChart({ points }: { points: EquityPoint[] }) {
  const data = toDrawdown(points)
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          {grid}
          <XAxis dataKey="date" tick={tick} tickFormatter={(v: string) => v.slice(0, 7)} minTickGap={40} />
          <YAxis tick={tick} width={48} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
          <Area type="monotone" dataKey="benchmark" name="買進持有" stroke={BENCHMARK_COLOR} fill={BENCHMARK_COLOR} fillOpacity={0.15} isAnimationActive={false} />
          <Area type="monotone" dataKey="strategy" name="策略" stroke={STRATEGY_COLOR} fill={STRATEGY_COLOR} fillOpacity={0.25} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function toDrawdown(points: EquityPoint[]): { date: string; strategy: number; benchmark: number }[] {
  let ps = -Infinity
  let pb = -Infinity
  return points.map((p) => {
    ps = Math.max(ps, p.strategy)
    pb = Math.max(pb, p.benchmark)
    return { date: p.date, strategy: (p.strategy / ps - 1) * 100, benchmark: (p.benchmark / pb - 1) * 100 }
  })
}
