import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { emergencyFundTarget, monthlyExpenseBaseline } from '../lib/calculations/journey'
import { StatCard } from '../components/StatCard'
import { inputClass, labelClass } from '../components/forms/FormField'
import { formatCurrency } from '../lib/format'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

export function JourneyPage() {
  const setFoundation = useAppStore((s) => s.setFoundation)
  const { state, journey, learning } = useJourney()

  const target = emergencyFundTarget(state)
  const baseline = monthlyExpenseBaseline(state)
  const fundPercent = target > 0 ? Math.min((state.foundation.emergencyFundAmount / target) * 100, 100) : 0

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">行動路線</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        先打好財務地基、買下整個市場，再學看懂市場，最後才練習選股。每一步都對應手冊的一章與工具的一頁。
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
          label="個股（衛星）"
          value={journey.satelliteUnlocked ? '已解鎖' : '尚未解鎖'}
          hint={journey.satelliteUnlocked ? undefined : `還缺 ${journey.missingForSatellite.length} 個步驟`}
        />
        <StatCard
          label="學習階段"
          value={learning.title}
          hint={`衛星上限 ${learning.satelliteCapPercent}%`}
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
              研究卡可以先寫來觀察；衛星買進要等起步前置步驟完成（
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
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">緊急預備金</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                放在活存或貨幣市場等隨時可動用的地方，不計入投資組合。每月支出
                取「目標與政策」財務自由試算的數字：
                {formatCurrency(baseline, state.profile.currency)}。
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={labelClass}>目前預備金金額</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    className={inputClass}
                    defaultValue={state.foundation.emergencyFundAmount}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v) && v >= 0) setFoundation({ emergencyFundAmount: v })
                    }}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>目標月數</span>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="1"
                    className={inputClass}
                    defaultValue={state.foundation.emergencyFundTargetMonths}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v) && v >= 1) setFoundation({ emergencyFundTargetMonths: v })
                    }}
                  />
                </label>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full bg-indigo-600" style={{ width: `${fundPercent}%` }} />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formatCurrency(state.foundation.emergencyFundAmount, state.profile.currency)} /{' '}
                {formatCurrency(target, state.profile.currency)}（{fundPercent.toFixed(0)}%）
              </p>
            </div>
          )}
        </div>
      ))}

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">學習階段：{learning.title}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          衛星上限依學習階段自動調整，目前為 {learning.satelliteCapPercent}%。
          {learning.demoted && '衛星連續 3 年落後基準，已降回上一階段。'}
        </p>
        {learning.nextCriteria.length > 0 ? (
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
          閱讀十年學習路線
        </Link>
      </div>
    </div>
  )
}
