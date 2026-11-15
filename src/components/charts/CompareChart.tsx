import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const tick = { fontSize: 11, fill: '#6b7280' }

// Fixed per template, never by rank, so a re-run with fewer rows keeps
// each curve's colour. Benchmarks are neutral.
const COLORS: Record<string, string> = {
  ma_cross: '#4f46e5',
  ma_200: '#0d9488',
  donchian: '#d97706',
  rsi_reversion: '#db2777',
  chip_flow: '#0284c7',
  buy_hold: '#6b7280',
  dca: '#9ca3af',
}
const EXTRA = ['#7c3aed', '#65a30d', '#b45309', '#be123c']

function compareColor(key: string, index: number): string {
  return COLORS[key] ?? EXTRA[index % EXTRA.length]
}

export interface CompareSeries {
  key: string
  label: string
  benchmark: boolean
}

// Growth of 100 for every template in a comparison; the dashed line marks
// where the out-of-sample period starts.
export function CompareChart({ series, points, oosStart }: { series: CompareSeries[]; points: { date: string; values: (number | null)[] }[]; oosStart: string | null }) {
  const data = points.map((p) => Object.fromEntries([['date', p.date], ...series.map((s, i) => [s.key, p.values[i]])]))
  const marker = oosStart ? points.find((p) => p.date >= oosStart)?.date : undefined
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.3} />
          <XAxis dataKey="date" tick={tick} tickFormatter={(v: string) => v.slice(0, 7)} minTickGap={40} />
          <YAxis tick={tick} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} />
          <Tooltip formatter={(v) => Number(v).toFixed(1)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {marker && <ReferenceLine x={marker} stroke="#6b7280" strokeDasharray="4 4" label={{ value: '樣本外', fontSize: 11, fill: '#6b7280' }} />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={compareColor(s.key, i)}
              strokeDasharray={s.benchmark ? '5 3' : undefined}
              dot={false}
              strokeWidth={s.benchmark ? 1.5 : 2}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
