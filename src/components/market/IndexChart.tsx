import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { sma } from '../../lib/backtest/indicators'
import type { IndexPoint } from '../../lib/market/indices'

const RANGES = [
  { label: '3 個月', sessions: 63 },
  { label: '1 年', sessions: 252 },
  { label: '3 年', sessions: 756 },
] as const

// Close in the accent colour; averages recede in muted, dashed strokes.
const LINES = [
  { key: 'close', name: '收盤', color: '#4f46e5', width: 2, dash: undefined },
  { key: 'sma20', name: '20 日線', color: '#d97706', width: 1.5, dash: '4 3' },
  { key: 'sma60', name: '60 日線', color: '#0d9488', width: 1.5, dash: '6 3' },
  { key: 'sma200', name: '200 日線', color: '#6b7280', width: 1.5, dash: undefined },
] as const

const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 })
const fmt = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : numberFormat.format(v))

export function IndexChart({ name, points }: { name: string; points: IndexPoint[] }) {
  const [range, setRange] = useState<number>(252)

  const rows = useMemo(() => {
    const closes = points.map((p) => p.close)
    const [s20, s60, s200] = [20, 60, 200].map((n) => sma(closes, n))
    const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
    return points.map((p, i) => ({ date: p.date, close: p.close, sma20: round(s20[i]), sma60: round(s60[i]), sma200: round(s200[i]) }))
  }, [points])
  const shown = rows.slice(-range)

  if (rows.length === 0) return <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">尚無{name}資料</p>

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{name}走勢</p>
        <div className="flex gap-1" role="group" aria-label="期間">
          {RANGES.map((r) => (
            <button
              key={r.sessions}
              type="button"
              onClick={() => setRange(r.sessions)}
              aria-pressed={range === r.sessions}
              className={`rounded px-2 py-0.5 text-xs ${
                range === r.sessions
                  ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
                  : 'border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={shown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#9ca3af" strokeOpacity={0.2} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickFormatter={(v: string) => (range > 252 ? v.slice(0, 7) : v.slice(5))}
              minTickGap={40}
            />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => numberFormat.format(v)} width={64} />
            <Tooltip
              formatter={(value) => fmt(Number(value))}
              labelFormatter={(l) => String(l)}
              itemSorter={(item) => LINES.findIndex((l) => l.key === item.dataKey)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
            {LINES.map((l) => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.name}
                stroke={l.color}
                strokeWidth={l.width}
                strokeDasharray={l.dash}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        <summary className="cursor-pointer text-gray-500 dark:text-gray-400">表格檢視（最近 10 個交易日）</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-right">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-1 text-left font-medium">日期</th>
                {LINES.map((l) => (
                  <th key={l.key} className="py-1 font-medium">
                    {l.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(-10)
                .reverse()
                .map((r) => (
                  <tr key={r.date} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-1 text-left">{r.date}</td>
                    <td className="py-1">{fmt(r.close)}</td>
                    <td className="py-1">{fmt(r.sma20)}</td>
                    <td className="py-1">{fmt(r.sma60)}</td>
                    <td className="py-1">{fmt(r.sma200)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
