import { Link } from 'react-router-dom'
import { useJourney } from '../lib/useJourney'
import { StatCard } from '../components/StatCard'
import { EmergencyFundBar } from '../components/forms/EmergencyFundForm'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

export function JourneyPage() {
  const { journey, learning } = useJourney()

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">行動路線</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        目標是財務獨立，全職經營自有資產：先打好財務地基、用核心 ETF 買下整個市場、看懂市場，再把交易策略回測、虛擬交易、小額實單逐關驗證。每一步都對應手冊的一章與工具的一頁。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="完成進度"
          value={`${journey.completedCount}/${journey.totalCount}`}
          hint="步驟"
        />
        <StatCard
          label="下一步"
          value={journey.nextStep ? journey.nextStep.id : '全部完成'}
          hint={journey.nextStep?.title}
        />
        <StatCard
          label="交易部位（實單）"
          value={journey.satelliteUnlocked ? '已解鎖' : '尚未解鎖'}
          hint={journey.satelliteUnlocked ? undefined : `還缺 ${journey.missingForSatellite.length} 個步驟`}
        />
        <StatCard
          label="學習階段"
          value={learning.title}
          hint={`交易部位上限 ${learning.satelliteCapPercent}%`}
        />
      </div>

      {journey.stages.map((stage) => (
        <div key={stage.number} className={cardClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              階段{['一', '二', '三', '四', '五'][stage.number - 1]}　{stage.title}
            </h2>
            {stage.done && (
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                已完成
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{stage.summary}</p>
          {stage.number === 4 && !journey.satelliteUnlocked && (
            <p className="mt-2 text-xs text-orange-700 dark:text-orange-400">
              策略卡、回測與虛擬交易隨時可以做；實單買進要等前置步驟完成（
              {journey.missingForSatellite.map((s) => s.id).join('、')}）。
            </p>
          )}
          <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-700">
            {stage.steps.map((step) => (
              <li key={step.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      step.done ? 'text-indigo-700 dark:text-indigo-400' : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {step.done ? '✓' : '☐'} {step.id} {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{step.detail}</p>
                </div>
                <div className="flex shrink-0 gap-3">
                  <Link to={`/handbook/${step.handbookSlug}`} className={linkClass}>
                    閱讀手冊
                  </Link>
                  {step.page.to !== '/journey' && (
                    <Link to={step.page.to} className={linkClass}>
                      前往{step.page.label}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {stage.number === 1 && (
            <div className="mt-4 rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">緊急預備金／生活費緩衝</h3>
              <EmergencyFundBar />
              <Link to="/goals" className={`${linkClass} mt-2 inline-block`}>
                到目標與政策填寫預備金與緩衝月數
              </Link>
            </div>
          )}
        </div>
      ))}

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">學習階段：{learning.title}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          交易部位上限依學習階段自動調整，目前為 {learning.satelliteCapPercent}%。
          {learning.demoted && '交易部位連續 3 年落後基準，已降回上一階段。'}
        </p>
        {learning.stage === 4 ? (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            離開本業、全職經營的條件見{' '}
            <Link to="/goals" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              目標與政策的全職準備度
            </Link>
            。
          </p>
        ) : learning.nextCriteria.length > 0 ? (
          <>
            <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">晉級下一階段的條件</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {learning.nextCriteria.map((c) => (
                <li
                  key={c.label}
                  className={c.met ? 'text-indigo-700 dark:text-indigo-400' : 'text-gray-700 dark:text-gray-300'}
                >
                  {c.met ? '✓' : '☐'} {c.label}：目前 {c.current}，需要 {c.target}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">已是最後一個階段。</p>
        )}
        <Link to="/handbook/09" className={`${linkClass} mt-3 inline-block`}>
          閱讀學習路線
        </Link>
      </div>
    </div>
  )
}
