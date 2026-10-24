import { ACTION_LABELS, type SignalAction, type SignalReport, type SignalTone } from '../../lib/research/signals'

const ACTION_STYLE: Record<SignalAction, string> = {
  buy: 'bg-indigo-600 text-white',
  add: 'bg-indigo-600 text-white',
  hold: 'bg-gray-600 text-white',
  wait: 'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600',
  avoid: 'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600',
  trim: 'bg-orange-600 text-white',
  exit: 'bg-orange-600 text-white',
  review: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:ring-orange-800',
}

const TONE_STYLE: Record<SignalTone, string> = {
  bull: 'text-indigo-700 dark:text-indigo-300',
  bear: 'text-orange-700 dark:text-orange-300',
  neutral: 'text-gray-500 dark:text-gray-400',
}
const TONE_MARK: Record<SignalTone, string> = { bull: '▲', bear: '▼', neutral: '•' }
const TONE_LABEL: Record<SignalTone, string> = { bull: '偏多', bear: '偏空', neutral: '中性' }

export function ActionBadge({ action, title }: { action: SignalAction; title?: string }) {
  return (
    <span title={title} className={`inline-block rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${ACTION_STYLE[action]}`}>
      {ACTION_LABELS[action]}
    </span>
  )
}

const fmt = (v: number) => (v >= 100 ? v.toFixed(1) : v.toFixed(2))

// Entry/exit advice under the health check: the action, the price ladder
// with today's price in place, and the observed signals.
export function SignalPanel({ report, price }: { report: SignalReport; price: number }) {
  // Today's price slots in between the levels (sorted high → low).
  const at = report.levels.findIndex((l) => l.price < price)
  const ladder = [...report.levels]
  const nowRow = { key: 'now', label: '現價', price, distancePercent: 0 } as const
  const rows: (typeof ladder[number] | typeof nowRow)[] = price > 0 ? [...ladder.slice(0, at < 0 ? ladder.length : at), nowRow, ...ladder.slice(at < 0 ? ladder.length : at)] : ladder

  return (
    <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">進出場建議{report.held ? '（已持有）' : ''}</p>
        {report.asOf && <span className="text-xs text-gray-400 dark:text-gray-500">價格資料 {report.asOf}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <ActionBadge action={report.action} />
        <p className="text-sm text-gray-800 dark:text-gray-200">{report.headline}</p>
      </div>
      {report.reasons.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-gray-600 dark:text-gray-400">
          {report.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {report.suggestedShares !== null && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          本批建議 <span className="font-semibold">{report.suggestedShares.toLocaleString()} 股</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">（{report.sizingNote}）</span>
          {report.stopLoss !== null && <>，停損 {fmt(report.stopLoss)}</>}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {rows.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">價位</p>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((l) =>
                  l.key === 'now' ? (
                    <tr key="now" className="bg-indigo-50 font-semibold text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200">
                      <td className="px-2 py-1">▶ 現價</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(l.price)}</td>
                      <td className="px-2 py-1" />
                    </tr>
                  ) : (
                    <tr key={l.key} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                      <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{l.label}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-900 dark:text-gray-100">{fmt(l.price)}</td>
                      <td className="px-2 py-1 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
                        {l.distancePercent > 0 ? '+' : ''}
                        {l.distancePercent.toFixed(1)}%
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">觀察到的訊號</p>
          <ul className="space-y-1 text-sm">
            {report.signals.map((s) => (
              <li key={s.key + s.label}>
                <span className={`font-medium ${TONE_STYLE[s.tone]}`} title={TONE_LABEL[s.tone]}>
                  {TONE_MARK[s.tone]} {s.label}
                </span>
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{s.detail}</span>
              </li>
            ))}
          </ul>
          {!report.asOf && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">尚無技術資料，按「更新體檢」後會帶入。</p>}
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">依研究卡合理價、均線動能、本月總經與持股自動計算，僅供參考；實際下單前仍要通過交易前檢核。</p>
    </div>
  )
}
