import { useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { computeNetCashFlow } from '../lib/calculations/netCashFlow'
import { MonthlyRecordForm } from '../components/forms/MonthlyRecordForm'
import { StatCard } from '../components/StatCard'
import { formatCurrency } from '../lib/format'
import type { MonthlyRecord } from '../lib/storage/schema'

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

export function MonthlyRecordsPage() {
  const profile = useAppStore((s) => s.profile)
  const monthlyRecords = useAppStore((s) => s.monthlyRecords)
  const addMonthlyRecord = useAppStore((s) => s.addMonthlyRecord)
  const updateMonthlyRecord = useAppStore((s) => s.updateMonthlyRecord)
  const removeMonthlyRecord = useAppStore((s) => s.removeMonthlyRecord)

  const currentMonth = currentMonthKey()

  const [editingId, setEditingId] = useState<string | null>(() => {
    const thisMonthRecord = monthlyRecords.find((r) => r.month === currentMonth)
    return thisMonthRecord ? thisMonthRecord.id : null
  })
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [mergedNotice, setMergedNotice] = useState(false)

  const editingRecord = editingId ? monthlyRecords.find((r) => r.id === editingId) : undefined
  const sortedRecords = [...monthlyRecords].sort((a, b) => b.month.localeCompare(a.month))

  const currentMonthRecord = monthlyRecords.find((r) => r.month === currentMonth)
  const currentMonthFlow = currentMonthRecord
    ? computeNetCashFlow(currentMonthRecord)
    : { incomeTotal: 0, expenseTotal: 0, investmentTotal: 0, netCashFlow: 0 }

  function resetToCurrentMonthDefault() {
    const thisMonthRecord = monthlyRecords.find((r) => r.month === currentMonth)
    setEditingId(thisMonthRecord ? thisMonthRecord.id : null)
  }

  function handleSubmit(values: Omit<MonthlyRecord, 'id' | 'createdAt'>) {
    const existingForMonth = monthlyRecords.find(
      (r) => r.month === values.month && r.id !== editingId,
    )
    if (existingForMonth) {
      updateMonthlyRecord(existingForMonth.id, values)
      setEditingId(existingForMonth.id)
      setMergedNotice(true)
      setTimeout(() => setMergedNotice(false), 3000)
      return
    }
    if (editingId) {
      updateMonthlyRecord(editingId, values)
      return
    }
    addMonthlyRecord(values)
    const newRecord = useAppStore.getState().monthlyRecords.find((r) => r.month === values.month)
    if (newRecord) setEditingId(newRecord.id)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">收支記錄</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        記錄每月收入、支出與投資金額，自動計算淨收支。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="本月收入"
          value={formatCurrency(currentMonthFlow.incomeTotal, profile.currency)}
          hint={currentMonthRecord ? undefined : '本月尚無紀錄'}
        />
        <StatCard
          label="本月支出"
          value={formatCurrency(currentMonthFlow.expenseTotal, profile.currency)}
          hint={currentMonthRecord ? undefined : '本月尚無紀錄'}
        />
        <StatCard
          label="本月投資"
          value={formatCurrency(currentMonthFlow.investmentTotal, profile.currency)}
          hint={currentMonthRecord ? undefined : '本月尚無紀錄'}
        />
        <StatCard
          label="本月淨收支"
          value={formatCurrency(currentMonthFlow.netCashFlow, profile.currency)}
          hint={currentMonthRecord ? undefined : '本月尚無紀錄'}
        />
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {editingRecord ? '編輯紀錄' : '新增紀錄'}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              + 新增其他月份紀錄
            </button>
          )}
        </div>
        {mergedNotice && (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            該月份已有紀錄，已合併更新至既有紀錄。
          </p>
        )}
        <div className="mt-4">
          <MonthlyRecordForm
            key={editingId ?? 'new'}
            initialValues={editingRecord}
            onSubmit={handleSubmit}
            onCancel={editingRecord ? resetToCurrentMonthDefault : undefined}
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">歷史紀錄</h2>
        {sortedRecords.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            還沒有任何紀錄，新增第一筆吧。
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4">月份</th>
                  <th className="py-2 pr-4">收入</th>
                  <th className="py-2 pr-4">支出</th>
                  <th className="py-2 pr-4">投資</th>
                  <th className="py-2 pr-4">淨收支</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map((r) => {
                  const flow = computeNetCashFlow(r)
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-700"
                    >
                      <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{r.month}</td>
                      <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                        {formatCurrency(flow.incomeTotal, profile.currency)}
                      </td>
                      <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                        {formatCurrency(flow.expenseTotal, profile.currency)}
                      </td>
                      <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                        {formatCurrency(flow.investmentTotal, profile.currency)}
                      </td>
                      <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                        {formatCurrency(flow.netCashFlow, profile.currency)}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteId(null)
                              setEditingId(r.id)
                            }}
                            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            編輯
                          </button>
                          {pendingDeleteId === r.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  removeMonthlyRecord(r.id)
                                  setPendingDeleteId(null)
                                  if (editingId === r.id) resetToCurrentMonthDefault()
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
                              onClick={() => setPendingDeleteId(r.id)}
                              className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
                            >
                              刪除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
