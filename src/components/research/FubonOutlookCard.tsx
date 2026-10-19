import { lazy, Suspense } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { fubonUsage, MACRO_PRIMARY_SOURCE } from '../../lib/ai/analyses'
import {
  gapSignals,
  isOutlookFresh,
  latestOutlook,
  MACRO_SIGNAL_LABELS,
  PILLAR_LABELS,
  trackForecasts,
} from '../../lib/calculations/fubonTracking'
import { todayIsoDate } from '../../lib/market/twse'
import { digestFubonOutlook } from '../../lib/ai/fubonOutlook'
import { useResearchTask } from '../../lib/ai/useResearchTask'
import { latestFubon, toOutlooks, type MacroData } from '../../lib/macro/macroData'
import { AiActionButton } from './AiActionButton'
import type { AllocationView, FubonOutlook, ResearchReport } from '../../lib/storage/schema'
import { FubonTrackingTable } from './FubonTrackingTable'

const MarkdownView = lazy(() => import('../MarkdownView').then((m) => ({ default: m.MarkdownView })))

const linkClass = 'font-medium text-indigo-700 underline dark:text-indigo-400'
const subTitle = 'mt-5 text-sm font-semibold text-gray-900 dark:text-gray-100'

const VIEW_STYLE: Record<AllocationView, { mark: string; className: string }> = {
  positive: { mark: '▲ 正向', className: 'text-indigo-700 dark:text-indigo-400' },
  neutral: { mark: '● 中性', className: 'text-gray-600 dark:text-gray-300' },
  negative: { mark: '▼ 負向', className: 'text-orange-700 dark:text-orange-400' },
}

const COVERAGE_MARK = { covered: '✓', partial: '△', missing: '✗' } as const

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

// How a market report used Fubon: built on a stored digest, or by reading
// the PDF itself (older flow), or not at all.
export function FubonUsageNote({ report }: { report: ResearchReport }) {
  const outlooks = useAppStore((s) => s.fubonOutlooks)
  if (report.fubonOutlookId) {
    const o = outlooks.find((x) => x.id === report.fubonOutlookId)
    return (
      <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
        ✓ 依據已整理的「{o?.reportTitle ?? '富邦報告'}」{o && `（${o.reportDate}）`}，只上網補查富邦未涵蓋的訊號
        {o && `（${gapSignals(o).length} 個）`}
      </p>
    )
  }
  const usage = fubonUsage(report.sources)
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
    </p>
  )
}

function CoverageList({ outlook }: { outlook: FubonOutlook }) {
  const byPillar = new Map<string, FubonOutlook['coverage']>()
  for (const c of outlook.coverage) {
    const pillar = c.signal.split('.')[0]
    byPillar.set(pillar, [...(byPillar.get(pillar) ?? []), c])
  }
  const gaps = gapSignals(outlook)
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(PILLAR_LABELS).map(([pillar, label]) => (
          <div key={pillar}>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {(byPillar.get(pillar) ?? []).map((c) => (
                <li
                  key={c.signal}
                  className={
                    c.status === 'covered'
                      ? 'text-indigo-700 dark:text-indigo-400'
                      : c.status === 'partial'
                        ? 'text-gray-700 dark:text-gray-300'
                        : 'text-gray-400'
                  }
                >
                  {COVERAGE_MARK[c.status]} {MACRO_SIGNAL_LABELS[c.signal]}
                  {c.note && `：${c.note}`}
                  {c.page && `（${c.page}）`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        ✓ 涵蓋　△ 部分　✗ 未涵蓋。總經分析會直接使用富邦已涵蓋的訊號，只上網補查其餘 {gaps.length} 個。
      </p>
    </div>
  )
}

// Research → Market: the latest Fubon outlook. Its allocation views,
// forecast ranges and key points come from the daily data job (rule-based,
// no API key); an optional AI digest adds a summary and signal coverage.
export function FubonOutlookCard({ data }: { data: MacroData | null }) {
  const digests = useAppStore((s) => s.fubonOutlooks)
  const taiex = useAppStore((s) => s.marketPriceHistory.taiex)
  const upsertFubonOutlook = useAppStore((s) => s.upsertFubonOutlook)
  const task = useResearchTask()

  const auto = data ? toOutlooks(data) : []
  const autoDates = new Set(auto.map((o) => o.reportDate))
  const all = [...auto, ...digests.filter((o) => !autoDates.has(o.reportDate))]
  const latest = latestOutlook(all)
  const digest = latest ? digests.find((o) => o.reportDate === latest.reportDate) : undefined
  const valuation = latestFubon(data)?.reportDate === latest?.reportDate ? latestFubon(data)?.valuation : null
  const tracking = trackForecasts(all, taiex, data?.indexCloses ?? {})
  const today = todayIsoDate()
  const keyPoints = latest?.sections.find((s) => s.title.includes('總經'))?.bullets ?? []

  async function runDigest() {
    const result = await task.run(() => digestFubonOutlook(todayIsoDate(), undefined, latest?.pdfUrl || undefined))
    if (result) upsertFubonOutlook(result)
  }

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">富邦總經觀點</h2>
        {data && <span className="text-xs text-gray-500 dark:text-gray-400">資料更新於 {formatDateTime(data.generatedAt)}</span>}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        每天由 GitHub 自動讀取富邦金控「富邦總經觀點－市場展望」，依固定格式擷取配置觀點、預測區間與各段重點（免 API 金鑰），並逐月追蹤預測命中。
      </p>

      {!latest ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          目前沒有可用的富邦報告資料。可以直接到{' '}
          <a href={MACRO_PRIMARY_SOURCE} target="_blank" rel="noreferrer" className={linkClass}>
            富邦金控研究報告
          </a>{' '}
          閱讀。
        </p>
      ) : (
        <div className="mt-5">
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {latest.reportTitle}
            <span className="ml-2 text-sm font-normal text-gray-500">{latest.reportDate}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            {latest.pdfUrl && (
              <a href={latest.pdfUrl} target="_blank" rel="noreferrer" className={linkClass}>
                開啟報告 PDF
              </a>
            )}
            <a href={MACRO_PRIMARY_SOURCE} target="_blank" rel="noreferrer" className={linkClass}>
              富邦金控研究報告
            </a>
          </div>
          {!isOutlookFresh(latest, today) && (
            <p className="mt-2 text-xs text-orange-700 dark:text-orange-400">
              最新一期已超過 45 天，富邦可能尚未發布本月報告。
            </p>
          )}

          {digest?.summary ? (
            <>
              <h3 className={subTitle}>摘要（AI 整理）</h3>
              <p className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300">{digest.summary}</p>
            </>
          ) : (
            keyPoints.length > 0 && (
              <>
                <h3 className={subTitle}>本期總經重點</h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300">
                  {keyPoints.map((b) => (
                    <li key={b.text}>
                      {b.text}
                      <span className="ml-1 text-xs text-gray-500">（{b.page}）</span>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}

          {latest.allocation.length > 0 && (
            <>
              <h3 className={subTitle}>月度配置觀點（報告原文，p.2）</h3>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <tbody>
                    {latest.allocation.map((a) => (
                      <tr key={a.asset} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-700">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-gray-900 dark:text-gray-100">{a.asset}</td>
                        <td className={`py-1.5 pr-3 whitespace-nowrap ${VIEW_STYLE[a.view].className}`}>
                          {VIEW_STYLE[a.view].mark}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400">{a.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                這是富邦的觀點，僅供參考；本工具的股債傾斜仍依總經三支柱判斷與配置微調上限。
              </p>
            </>
          )}

          {valuation && (
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              S&P 500 未來 12 個月預估本益比 {valuation.pe} 倍
              {valuation.average !== null && `，近 10 年平均 ${valuation.average}`}
              {valuation.sdLow !== null && valuation.sdHigh !== null && `（一個標準差 ${valuation.sdLow}～${valuation.sdHigh}）`}
            </p>
          )}

          {latest.sections.length > 0 && (
            <>
              <h3 className={subTitle}>各段重點</h3>
              <div className="mt-1 space-y-2">
                {latest.sections.map((sec) => (
                  <details key={sec.title} className="text-sm">
                    <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">{sec.title}</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700 dark:text-gray-300">
                      {sec.bullets.map((b) => (
                        <li key={b.text}>
                          {b.text}
                          {b.page && <span className="ml-1 text-xs text-gray-500">（{b.page}）</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </>
          )}

          {digest && digest.coverage.length > 0 && (
            <>
              <h3 className={subTitle}>對總經三支柱的涵蓋度（AI 整理）</h3>
              <div className="mt-1">
                <CoverageList outlook={digest} />
              </div>
            </>
          )}

          <h3 className={subTitle}>指數追蹤：預測區間 vs 實際</h3>
          <div className="mt-1">
            <FubonTrackingTable rows={tracking.rows} evaluations={tracking.evaluations} />
          </div>

          <div className="mt-5 rounded-md bg-gray-50 p-3 dark:bg-gray-900/40">
            <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">
              選用：讓 AI 讀這份 PDF，產生摘要與「對 17 個訊號的涵蓋度」。不按也不影響每日自動判斷。
            </p>
            <AiActionButton
              label={digest ? '重新產生 AI 摘要' : 'AI 摘要與涵蓋度'}
              running={task.running}
              error={task.error}
              hasApiKey={task.hasApiKey}
              costNote="約 US$0.1，使用你的 Anthropic API 金鑰"
              onClick={() => void runDigest()}
            />
          </div>

          {digest?.markdown && (
            <details className="mt-5 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
                AI 整理全文與出處（［編號, p.頁數］對應來源）
              </summary>
              <div className="mt-2">
                <Suspense fallback={<p className="text-xs text-gray-500">載入中…</p>}>
                  <MarkdownView content={digest.markdown} />
                </Suspense>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
