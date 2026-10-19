import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AdviceGuardrails, MacroCheckIn, MacroSignalKey } from '../../lib/storage/schema'
import type { MacroData } from '../../lib/macro/macroData'
import {
  indicatorSeries,
  judgementTimeline,
  lastYears,
  signalMatrix,
  signalSign,
  signalText,
  type CheckInSource,
  type IndicatorChart,
  type MatrixCell,
} from '../../lib/macro/history'
import { MACRO_SIGNAL_LABELS, PILLAR_LABELS } from '../../lib/calculations/fubonTracking'
import { METRIC_LABELS } from '../../lib/macro/signalRules'

type Tab = 'timeline' | 'matrix' | 'charts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: '判斷歷程' },
  { id: 'matrix', label: '訊號熱度圖' },
  { id: 'charts', label: '指標走勢' },
]

const SOURCE_LABELS: Record<CheckInSource, string> = { auto: '自動', manual: '手動修正', ai: 'AI' }

const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-2 pr-3 align-top text-gray-700 dark:text-gray-300'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

// Diverging cell colours (validated for colour-vision deficiency on both
// surfaces); the symbol inside carries the meaning as well.
const CELL_STYLE: Record<-1 | 0 | 1, string> = {
  1: 'bg-[#4f46e5] text-white dark:bg-[#6366f1]',
  0: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  [-1]: 'bg-[#ea580c] text-white',
}

function cellSymbol(key: MacroSignalKey, cell: MatrixCell): string {
  if (typeof cell.value === 'string') return { up: '↑', flat: '→', down: '↓' }[cell.value]
  return key.startsWith('liquidity.') || key.startsWith('sentiment.') ? (cell.value > 0 ? '+1' : cell.value < 0 ? '−1' : '0') : String(cell.value)
}

function formatMetric(key: MacroSignalKey, value: number | null): string {
  if (value === null) return ''
  const unit = METRIC_LABELS[key]?.unit ?? ''
  return `${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`
}

function shortMonth(month: string): string {
  return `${month.slice(2, 4)}/${month.slice(5, 7)}`
}

function Timeline({
  checkIns,
  guardrails,
  onEdit,
  onDelete,
}: {
  checkIns: MacroCheckIn[]
  guardrails: AdviceGuardrails
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const rows = judgementTimeline(checkIns, guardrails)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  if (rows.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">還沒有總經檢視。</p>
  return (
    <div>
      {rows.length < 2 && (
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">每月自動新增一筆；從第二個月起，這裡會列出與上月相比的變化。</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {['月份', '景氣體制', '流動性', '情緒', '綜合判斷', '股票傾斜', '來源', '與上月相比', ''].map((h) => (
                <th key={h} className={thClass}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.checkIn.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                <td className={`${tdClass} whitespace-nowrap font-medium text-gray-900 dark:text-gray-100`}>{r.month}</td>
                <td className={`${tdClass} whitespace-nowrap`}>{r.regime}</td>
                <td className={tdClass}>{r.assessment.liquidityScore > 0 ? `+${r.assessment.liquidityScore}` : r.assessment.liquidityScore}</td>
                <td className={tdClass}>{r.assessment.sentimentScore > 0 ? `+${r.assessment.sentimentScore}` : r.assessment.sentimentScore}</td>
                <td className={`${tdClass} whitespace-nowrap font-medium text-gray-900 dark:text-gray-100`}>{r.stance}</td>
                <td className={`${tdClass} text-xs`}>{r.tilt}</td>
                <td className={`${tdClass} whitespace-nowrap text-xs`}>{SOURCE_LABELS[r.source]}</td>
                <td className={`${tdClass} text-xs`}>
                  {r.changes.length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : r.changes.length <= 3 ? (
                    <ul className="space-y-0.5">
                      {r.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <details>
                      <summary className="cursor-pointer">
                        {r.changes.slice(0, 2).join('；')} 等 {r.changes.length} 項
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {r.changes.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className={`${tdClass} whitespace-nowrap`}>
                  <span className="flex gap-2">
                    <button type="button" onClick={() => onEdit(r.checkIn.id)} className={linkClass}>
                      編輯
                    </button>
                    {pendingDelete === r.checkIn.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(r.checkIn.id)
                            setPendingDelete(null)
                          }}
                          className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                        >
                          確定刪除
                        </button>
                        <button type="button" onClick={() => setPendingDelete(null)} className="text-xs text-gray-500 hover:underline">
                          取消
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setPendingDelete(r.checkIn.id)} className="text-xs text-gray-500 hover:underline">
                        刪除
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Matrix({ checkIns }: { checkIns: MacroCheckIn[] }) {
  const matrix = signalMatrix(checkIns, 12)
  const [selected, setSelected] = useState<{ key: MacroSignalKey; index: number } | null>(null)
  if (matrix.months.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">還沒有總經檢視。</p>
  const pillars = Object.entries(PILLAR_LABELS)
  const sel = selected ? matrix.rows.find((r) => r.key === selected.key)?.cells[selected.index] : null

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
        紫藍＝上升／寬鬆／過熱，橘＝下降／緊縮／恐慌，灰＝持平／中性；橘框代表沒有數據、需要手動確認。點格子看當月數字與理由。
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className={`${thClass} sticky left-0 bg-white dark:bg-gray-800`}>訊號</th>
              {matrix.months.map((m) => (
                <th key={m} className="px-1 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
                  {shortMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pillars.map(([pillar, label]) => (
              <PillarRows key={pillar} label={label} rows={matrix.rows.filter((r) => r.key.startsWith(`${pillar}.`))} span={matrix.months.length} selected={selected} onSelect={setSelected} />
            ))}
          </tbody>
        </table>
      </div>
      {selected && sel && (
        <div className="mt-3 rounded-md border border-gray-200 p-3 text-sm dark:border-gray-700">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {matrix.months[selected.index]}・{MACRO_SIGNAL_LABELS[selected.key]}：{signalText(selected.key, sel.value)}
            {sel.metric !== null && `（${METRIC_LABELS[selected.key]?.label ?? ''} ${formatMetric(selected.key, sel.metric)}）`}
          </p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{sel.reason ?? '這個月是手動或 AI 判斷，沒有自動規則的理由紀錄。'}</p>
        </div>
      )}
    </div>
  )
}

function PillarRows({
  label,
  rows,
  span,
  selected,
  onSelect,
}: {
  label: string
  rows: { key: MacroSignalKey; cells: (MatrixCell | null)[] }[]
  span: number
  selected: { key: MacroSignalKey; index: number } | null
  onSelect: (s: { key: MacroSignalKey; index: number }) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={span + 1} className="pt-2 pb-0.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
          {label}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.key}>
          <td className="sticky left-0 bg-white pr-3 whitespace-nowrap text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {MACRO_SIGNAL_LABELS[row.key]}
          </td>
          {row.cells.map((cell, i) =>
            cell ? (
              <td key={i} className="p-0">
                <button
                  type="button"
                  title={`${signalText(row.key, cell.value)}${cell.metric !== null ? `・${formatMetric(row.key, cell.metric)}` : ''}`}
                  onClick={() => onSelect({ key: row.key, index: i })}
                  className={`h-7 w-11 rounded-sm text-xs font-semibold ${CELL_STYLE[signalSign(cell.value)]} ${
                    cell.manual ? 'ring-2 ring-[#ea580c] ring-inset' : ''
                  } ${selected?.key === row.key && selected.index === i ? 'outline-2 outline-offset-1 outline-gray-900 dark:outline-gray-100' : ''}`}
                >
                  {cellSymbol(row.key, cell)}
                </button>
              </td>
            ) : (
              <td key={i} className="h-7 w-11 text-center text-gray-300">
                ·
              </td>
            ),
          )}
        </tr>
      ))}
    </>
  )
}

const tick = { fontSize: 11, fill: '#6b7280' }

function IndicatorCard({ chart, years }: { chart: IndicatorChart; years: number }) {
  const points = lastYears(chart.points, years)
  const last = chart.points[chart.points.length - 1]
  const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
  return (
    <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{chart.label}</p>
        <p className="text-sm text-gray-900 dark:text-gray-100">
          {fmt(last.value)}
          {chart.unit && <span className="ml-0.5 text-xs text-gray-500">{chart.unit}</span>}
          <span className="ml-1 text-xs text-gray-400">{last.date.slice(0, 7)}</span>
        </p>
      </div>
      <div className="mt-1 h-36 w-full text-[#4f46e5] dark:text-[#6366f1]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.25} vertical={false} />
            <XAxis dataKey="date" tick={tick} tickFormatter={(v: string) => shortMonth(v.slice(0, 7))} minTickGap={28} />
            <YAxis tick={tick} width={40} domain={['auto', 'auto']} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip
              formatter={(v) => [`${fmt(Number(v))}${chart.unit === '%' ? '%' : chart.unit ? ` ${chart.unit}` : ''}`, chart.label]}
              labelFormatter={(l) => String(l).slice(0, 7)}
            />
            {chart.thresholds.map((t) => (
              <ReferenceLine
                key={t.value}
                y={t.value}
                stroke="#9ca3af"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={t.label ? { value: t.label, position: 'insideTopRight', fontSize: 10, fill: '#6b7280' } : undefined}
              />
            ))}
            <Line type="linear" dataKey="value" stroke="currentColor" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">資料來源：{chart.source}</p>
    </div>
  )
}

function Charts({ data }: { data: MacroData | null }) {
  const [years, setYears] = useState(2)
  const charts = useMemo(() => (data ? indicatorSeries(data) : []), [data])
  if (!data) return <p className="text-sm text-gray-500 dark:text-gray-400">讀不到每日總經資料，無法顯示走勢。</p>
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-gray-500 dark:text-gray-400">期間</span>
        {[1, 2, 3].map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYears(y)}
            className={`rounded px-2 py-1 ${years === y ? 'bg-indigo-600 text-white' : 'text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700'}`}
          >
            {y} 年
          </button>
        ))}
        <span className="text-gray-500 dark:text-gray-400">虛線為判斷規則的門檻（手冊 05 §5）</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {charts.map((c) => (
          <IndicatorCard key={c.id} chart={c} years={years} />
        ))}
      </div>
    </div>
  )
}

// Research → Market: the macro review over time.
export function MacroTracking({
  checkIns,
  guardrails,
  data,
  onEdit,
  onDelete,
}: {
  checkIns: MacroCheckIn[]
  guardrails: AdviceGuardrails
  data: MacroData | null
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [tab, setTab] = useState<Tab>('timeline')
  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">總經追蹤</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        每月一筆：判斷怎麼變、哪些訊號在變，以及背後的指標走勢。
      </p>
      <div role="tablist" className="mt-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'timeline' && <Timeline checkIns={checkIns} guardrails={guardrails} onEdit={onEdit} onDelete={onDelete} />}
        {tab === 'matrix' && <Matrix checkIns={checkIns} />}
        {tab === 'charts' && <Charts data={data} />}
      </div>
    </div>
  )
}
