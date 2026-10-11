import {
  TRACKED_INDEX_LABELS,
  type ForecastEvaluation,
  type ForecastResult,
  type TrackingRow,
} from '../../lib/calculations/fubonTracking'

function fmt(value: number): string {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
}

function range(low: number, high: number, unit: string): string {
  return `${fmt(low)}～${fmt(high)}${unit}`
}

const RESULT_TEXT: Record<ForecastResult, { text: string; className: string }> = {
  hit: { text: '✓ 區間內', className: 'text-indigo-700 dark:text-indigo-400' },
  miss: { text: '✗ 區間外', className: 'text-orange-700 dark:text-orange-400' },
  nodata: { text: '— 無資料', className: 'text-gray-400' },
}

// Fubon's monthly forecast ranges versus what actually happened.
export function FubonTrackingTable({
  rows,
  evaluations,
}: {
  rows: TrackingRow[]
  evaluations: ForecastEvaluation[]
}) {
  const visible = rows.filter((r) => r.current || r.lastEvaluation)
  if (visible.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">這期報告沒有可追蹤的預測區間。</p>
  }
  const months = [...new Set(evaluations.map((e) => e.month))].sort().reverse()

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="py-2 pr-3">項目</th>
              <th className="py-2 pr-3">本月預測區間</th>
              <th className="py-2 pr-3">上期預測區間</th>
              <th className="py-2 pr-3">實際</th>
              <th className="py-2 pr-3">結果</th>
              <th className="py-2 pr-3">累計命中</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const { label, unit } = TRACKED_INDEX_LABELS[r.index]
              const last = r.lastEvaluation
              return (
                <tr key={r.index} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">{label}</td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                    {r.current ? range(r.current.low, r.current.high, unit) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">
                    {last ? `${range(last.low, last.high, unit)}（${last.month}）` : '—'}
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                    {last?.actual != null ? `${fmt(last.actual)}${unit}` : '—'}
                  </td>
                  <td className={`py-2 pr-3 ${last ? RESULT_TEXT[last.result].className : 'text-gray-400'}`}>
                    {last ? RESULT_TEXT[last.result].text : '待下期報告'}
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                    {r.evaluated > 0 ? `${r.hits}/${r.evaluated}（${Math.round((r.hits / r.evaluated) * 100)}%）` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        每期報告預測下個月的區間，並在下一期列出實際月底數值；兩期對照即可檢驗命中與否。台股加權指數若報告未列，改用證交所月底收盤。
      </p>

      {months.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">逐月紀錄</summary>
          {months.map((m) => (
            <div key={m} className="mt-2">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{m}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {evaluations
                  .filter((e) => e.month === m)
                  .map((e) => {
                    const { label, unit } = TRACKED_INDEX_LABELS[e.index]
                    return (
                      <li key={e.index} className={RESULT_TEXT[e.result].className}>
                        {label}：預測 {range(e.low, e.high, unit)}，實際 {e.actual != null ? `${fmt(e.actual)}${unit}` : '—'}，
                        {RESULT_TEXT[e.result].text}
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
