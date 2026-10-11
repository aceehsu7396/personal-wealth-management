import { fubonUsage, MACRO_PRIMARY_SOURCE, StoredMacroDraftSchema } from '../../lib/ai/analyses'
import type { ResearchReport, ResearchSource } from '../../lib/storage/schema'

// Whether a market report actually read and cited the Fubon outlook PDF.
export function FubonUsageNote({ sources }: { sources: ResearchSource[] }) {
  const usage = fubonUsage(sources)
  if (!usage.report) {
    return (
      <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">
        ⚠ 這份報告沒有讀取到富邦報告全文，資料來自網路搜尋。
      </p>
    )
  }
  return (
    <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
      ✓ 已讀取「{usage.report.title}」全文，引用 {usage.citedCount} 處
      {usage.pages.length > 0 && `（p.${usage.pages.join('、')}）`}
      {usage.citedCount === 0 && '，但報告內容沒有標註引用，請展開報告確認'}
    </p>
  )
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

const linkClass = 'font-medium text-indigo-700 underline dark:text-indigo-400'

// Fubon's latest macro outlook as used by the most recent AI market analysis.
// Refreshed every time the market analysis runs.
export function FubonOutlookCard({ latest }: { latest: ResearchReport | undefined }) {
  const parsed = latest ? StoredMacroDraftSchema.safeParse(latest.facts) : null
  const summary = parsed?.success ? parsed.data.fubonSummary : undefined
  const usage = latest ? fubonUsage(latest.sources) : null

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">富邦總經觀點</h2>
        {latest && <span className="text-xs text-gray-500 dark:text-gray-400">更新於 {formatDateTime(latest.createdAt)}</span>}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        總經檢視以富邦金控每月「富邦總經觀點－市場展望」為主要依據，每次執行下方「AI 取得總經資訊並預填」時更新。
      </p>

      {!latest ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          還沒有市場分析。執行「AI 取得總經資訊並預填」後，這裡會顯示最新一期報告與重點；也可以直接到{' '}
          <a href={MACRO_PRIMARY_SOURCE} target="_blank" rel="noreferrer" className={linkClass}>
            富邦金控研究報告列表
          </a>{' '}
          閱讀。
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {summary?.reportTitle || usage?.report?.title || '未讀取到富邦報告'}
            {summary?.reportDate && <span className="ml-2 text-sm font-normal text-gray-500">{summary.reportDate}</span>}
          </p>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            {usage?.report && (
              <a href={usage.report.url} target="_blank" rel="noreferrer" className={linkClass}>
                開啟報告 PDF
              </a>
            )}
            <a href={MACRO_PRIMARY_SOURCE} target="_blank" rel="noreferrer" className={linkClass}>
              富邦金控研究報告列表
            </a>
          </div>
          <FubonUsageNote sources={latest.sources} />

          {summary && summary.keyPoints.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
              {summary.keyPoints.map((k) => (
                <li key={k.point}>
                  {k.point}
                  {k.page && <span className="ml-1 text-xs text-gray-500">（{k.page}）</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              這次分析沒有整理出富邦重點（可能是舊版分析或未讀取到報告），重新執行一次市場分析即可更新。
            </p>
          )}
        </div>
      )}

      <details className="mt-4 text-xs text-gray-600 dark:text-gray-400">
        <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300">資料來源與出處標註說明</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>AI 先開啟富邦金控研究報告列表，讀取最新一期「市場展望」PDF 全文；最近 1 個月相關的「富邦總經分析」也一併參考。</li>
          <li>報告沒有涵蓋、或報告發布後才公布的數據（例如最新 PMI、CPI、VIX），再上網搜尋補充。</li>
          <li>每段引用後面標示［來源編號, p.頁數］，對應報告下方的來源清單；清單會註明哪些文件「已讀取全文」、被引用幾處。</li>
          <li>預填的 17 個訊號理由結尾也會附出處，例如「（富邦 9 月市場展望 p.3）」。</li>
          <li>富邦每月初發布新一期展望；月底檢視時，主要觀點可能已接近一個月前，最新數字以網路補充為準。</li>
        </ul>
      </details>
    </div>
  )
}
