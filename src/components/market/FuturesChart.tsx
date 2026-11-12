import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FUTURES_NAME, sessionLabel, type FuturesBar } from '../../lib/market/futures'
import type { IndexPoint } from '../../lib/market/indices'

// Two sessions per trading day.
const RANGES = [
  { label: '1 個月', sessions: 44 },
  { label: '3 個月', sessions: 126 },
  { label: '1 年', sessions: 504 },
] as const

const FUTURES_COLOR = '#4f46e5'
const SPOT_COLOR = '#6b7280'

const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })
const fmt = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : numberFormat.format(v))
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${numberFormat.format(Math.abs(v))}`

interface Row {
  key: string
  label: string
  date: string
  session: FuturesBar['session']
  futures: number
  spot: number | null
}

// Night closes drawn hollow, day closes filled, so the two sessions read
// apart without a second colour.
function SessionDot(props: { cx?: number; cy?: number; payload?: Row }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload) return null
  return payload.session === 'night' ? (
    <circle cx={cx} cy={cy} r={3} className="fill-white dark:fill-gray-800" stroke={FUTURES_COLOR} strokeWidth={1.5} />
  ) : (
    <circle cx={cx} cy={cy} r={2.5} fill={FUTURES_COLOR} />
  )
}

// Every session close of 台指期 in trading order (night, then day), with
// the TAIEX close beside each day session.
export function FuturesChart({ bars, taiex }: { bars: FuturesBar[]; taiex: IndexPoint[] }) {
  const [range, setRange] = useState<number>(44)
  const rows = useMemo<Row[]>(() => {
    const spot = new Map(taiex.map((p) => [p.date, p.close]))
    return bars.map((b) => ({
      key: `${b.date}|${b.session}`,
      label: sessionLabel(bars, b),
      date: b.date,
      session: b.session,
      futures: b.close,
      spot: b.session === 'day' ? (spot.get(b.date) ?? null) : null,
    }))
  }, [bars, taiex])
  const shown = rows.slice(-range)
  const showDots = range <= 44

  if (rows.length === 0) return <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">尚無{FUTURES_NAME}資料</p>

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{FUTURES_NAME}（近月）日盤與夜盤走勢</p>
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
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        每一點是一盤的收盤：空心為夜盤（前一交易日 15:00 至當日 05:00），實心為日盤（08:45–13:45）。夜盤收盤通常預示加權指數隔天的開盤方向。
      </p>
      <div className="mt-2 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={shown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#9ca3af" strokeOpacity={0.2} vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickFormatter={(v: string) => (range > 126 ? v.slice(0, 7) : v.slice(5, 10))}
              minTickGap={40}
            />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => numberFormat.format(v)} width={64} />
            <Tooltip
              formatter={(value) => fmt(Number(value))}
              labelFormatter={(_, payload) => (payload?.[0]?.payload as Row | undefined)?.label ?? ''}
              itemSorter={(item) => (item.dataKey === 'futures' ? 0 : 1)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
            <Line
              type="linear"
              dataKey="futures"
              name={`${FUTURES_NAME}（每盤收盤）`}
              stroke={FUTURES_COLOR}
              strokeWidth={2}
              dot={showDots ? <SessionDot /> : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="spot"
              name="加權指數收盤"
              stroke={SPOT_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        <summary className="cursor-pointer text-gray-500 dark:text-gray-400">表格檢視（最近 10 盤）</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-right">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-1 pr-2 text-left font-medium">盤別</th>
                <th className="py-1 pr-2 font-medium">月份</th>
                <th className="py-1 pr-2 font-medium">開盤</th>
                <th className="py-1 pr-2 font-medium">最高</th>
                <th className="py-1 pr-2 font-medium">最低</th>
                <th className="py-1 pr-2 font-medium">收盤</th>
                <th className="py-1 pr-2 font-medium">漲跌</th>
                <th className="py-1 font-medium">成交量（口）</th>
              </tr>
            </thead>
            <tbody>
              {bars
                .slice(-10)
                .reverse()
                .map((b) => (
                  <tr key={`${b.date}|${b.session}`} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-1 pr-2 text-left">{sessionLabel(bars, b)}</td>
                    <td className="py-1 pr-2">{b.contract}</td>
                    <td className="py-1 pr-2">{fmt(b.open)}</td>
                    <td className="py-1 pr-2">{fmt(b.high)}</td>
                    <td className="py-1 pr-2">{fmt(b.low)}</td>
                    <td className="py-1 pr-2">{fmt(b.close)}</td>
                    <td className={`py-1 pr-2 ${b.change >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-red-600 dark:text-red-400'}`}>{signed(b.change)}</td>
                    <td className="py-1">{fmt(b.volume)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
