import { useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import { CheckInForm } from '../components/forms/CheckInForm'
import { ActualVsProjectedChart } from '../components/charts/ActualVsProjectedChart'
import { formatCurrency } from '../lib/format'

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

export function ProgressTrackerPage() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const checkIns = useAppStore((s) => s.checkIns)
  const addCheckIn = useAppStore((s) => s.addCheckIn)
  const updateCheckIn = useAppStore((s) => s.updateCheckIn)
  const removeCheckIn = useAppStore((s) => s.removeCheckIn)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const result = computeFireProjection(profile, assumptions)

  const sortedCheckIns = [...checkIns].sort((a, b) => b.date.localeCompare(a.date))
  const latestCheckIn = sortedCheckIns[0]
  const latestNetWorth = latestCheckIn ? latestCheckIn.netWorthAmount : assumptions.currentNetWorth
  const progressPercent =
    Number.isFinite(result.fireNumber) && result.fireNumber > 0
      ? (latestNetWorth / result.fireNumber) * 100
      : null

  const editingCheckIn = editingId ? checkIns.find((c) => c.id === editingId) : undefined

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
        進度追蹤
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        定期記錄實際淨值，對照 FIRE 試算軌跡，隨時掌握進度。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="最新淨值"
          value={formatCurrency(latestNetWorth, profile.currency)}
          hint={latestCheckIn ? `紀錄於 ${latestCheckIn.date}` : '尚無紀錄，顯示試算假設中的目前淨資產'}
        />
        <StatCard
          label="達成進度"
          value={progressPercent !== null ? `${progressPercent.toFixed(1)}%` : '—'}
          hint={
            Number.isFinite(result.fireNumber)
              ? `目標 ${formatCurrency(result.fireNumber, profile.currency)}`
              : undefined
          }
        />
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <ActualVsProjectedChart
          projectedPoints={result.points}
          checkIns={checkIns}
          currency={profile.currency}
        />
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {editingCheckIn ? '編輯紀錄' : '新增淨值紀錄'}
        </h2>
        <div className="mt-4">
          <CheckInForm
            key={editingId ?? 'new'}
            initialValues={editingCheckIn}
            onSubmit={(values) => {
              if (editingId) {
                updateCheckIn(editingId, values)
                setEditingId(null)
              } else {
                addCheckIn(values)
              }
            }}
            onCancel={editingCheckIn ? () => setEditingId(null) : undefined}
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          歷史紀錄
        </h2>
        {sortedCheckIns.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            還沒有任何紀錄，新增第一筆吧。
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4">日期</th>
                  <th className="py-2 pr-4">淨值</th>
                  <th className="py-2 pr-4">備註</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedCheckIns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-700"
                  >
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{c.date}</td>
                    <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(c.netWorthAmount, profile.currency)}
                    </td>
                    <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">
                      {c.note || '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingDeleteId(null)
                            setEditingId(c.id)
                          }}
                          className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          編輯
                        </button>
                        {pendingDeleteId === c.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                removeCheckIn(c.id)
                                setPendingDeleteId(null)
                              }}
                              className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                            >
                              確定刪除
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(null)}
                              className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(c.id)}
                            className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                          >
                            刪除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
