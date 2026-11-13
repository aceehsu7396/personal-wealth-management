import { useSearchParams } from 'react-router-dom'
import { DecisionJournal } from '../components/calibration/DecisionJournal'
import { ScenarioWorkbench } from '../components/calibration/ScenarioWorkbench'
import { RegimeReview } from '../components/calibration/RegimeReview'
import { AnnualReport } from '../components/calibration/AnnualReport'
import { PageHeader } from '../components/ui'

const TABS = [
  { key: 'decisions', label: '決策日誌' },
  { key: 'scenarios', label: '情境工作台' },
  { key: 'regime', label: '局勢判斷回顧' },
  { key: 'annual', label: '年度檢討報告' },
] as const

type Tab = (typeof TABS)[number]['key']

// Review and calibration (handbook 05 §8): decisions, scenarios and
// regime calls checked against what happened, and the yearly report. One
// section at a time keeps the page short.
export function CalibrationPage() {
  const [search, setSearch] = useSearchParams()
  const requested = search.get('tab')
  const tab: Tab = search.get('decision') === 'new' ? 'decisions' : (TABS.find((t) => t.key === requested)?.key ?? 'decisions')
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title="檢討與校準" summary="把事前的判斷和事後的結果放在一起：決策、情境機率與局勢判斷各自對了多少，每年 1 月產生年度檢討報告。" />
      <div className="mt-6 flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="檢討項目">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setSearch({ tab: t.key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'decisions' && <DecisionJournal />}
        {tab === 'scenarios' && <ScenarioWorkbench />}
        {tab === 'regime' && <RegimeReview />}
        {tab === 'annual' && <AnnualReport />}
      </div>
    </div>
  )
}
