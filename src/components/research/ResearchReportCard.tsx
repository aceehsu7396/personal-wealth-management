import { lazy, Suspense, useState } from 'react'
import type { ResearchReport } from '../../lib/storage/schema'

// The Markdown renderer is loaded only when a report is opened.
const MarkdownView = lazy(() => import('../MarkdownView').then((m) => ({ default: m.MarkdownView })))

const KIND_LABELS: Record<ResearchReport['kind'], string> = {
  market: '市場分析',
  industry: '產業分析',
  stock: '個股分析',
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function ResearchReportCard({
  report,
  defaultOpen = false,
  onDelete,
}: {
  report: ResearchReport
  defaultOpen?: boolean
  onDelete?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 text-left">
          <span className="mr-2 rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
            {KIND_LABELS[report.kind]}
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{report.subject}</span>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            {formatDateTime(report.createdAt)}・來源 {report.sources.length} 筆・約 US${report.estimatedCostUsd.toFixed(2)}
          </span>
        </button>
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={() => setOpen(!open)} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
            {open ? '收合' : '展開報告'}
          </button>
          {onDelete &&
            (confirmDelete ? (
              <>
                <button type="button" onClick={onDelete} className="font-medium text-red-600 hover:underline dark:text-red-400">
                  確定刪除
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:underline">
                  取消
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-gray-500 hover:underline dark:text-gray-400">
                刪除
              </button>
            ))}
        </div>
      </div>
      {open && (
        <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
          <Suspense fallback={<p className="text-sm text-gray-500">載入報告中…</p>}>
            <MarkdownView content={report.markdown} />
          </Suspense>
          {report.sources.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">資料來源</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                {report.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline dark:text-indigo-400">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            AI 依公開網路資料整理，可能有錯漏；數字請以來源為準。僅供研究參考，不構成投資建議。
          </p>
        </div>
      )}
    </div>
  )
}
