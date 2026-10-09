import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { todayIsoDate } from '../lib/market/twse'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import {
  computeRequiredReturn,
  FEASIBILITY_LABELS,
} from '../lib/calculations/requiredReturn'
import { InvestmentPolicyForm } from '../components/forms/InvestmentPolicyForm'
import { StatCard } from '../components/StatCard'
import { AssumptionsForm } from '../components/forms/AssumptionsForm'
import { NetWorthProjectionChart } from '../components/charts/NetWorthProjectionChart'
import { formatCurrency, formatDate, formatYearsToFire } from '../lib/format'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

const PRINCIPLES = [
  '投資政策定框架：只在每年 1 月或人生重大事件時修改，市場大漲大跌時不改。',
  '由上而下決定「多少」：總經只能在 ± 配置微調上限內調整股債比例。',
  '由下而上決定「買什麼」：衛星個股必須通過產業、財務、估值三關。',
  '風控優先於看法：部位上限與回撤熔斷不因個別觀點而放寬。',
  '評估流程而非結果：每筆交易留下理由，事後以歸因區分運氣與能力。',
]

export function GoalsPage() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const policy = useAppStore((s) => s.investmentPolicy)
  const setInvestmentPolicy = useAppStore((s) => s.setInvestmentPolicy)
  const { learning } = useJourney()

  const projection = computeFireProjection(profile, assumptions)
  const required = computeRequiredReturn(
    profile,
    assumptions,
    policy.targetYears,
  )
  const requiredText =
    required.requiredNominalReturnPercent === null
      ? '—'
      : `${required.requiredNominalReturnPercent.toFixed(2)}%`
  const meetsAssumption =
    required.requiredNominalReturnPercent !== null &&
    assumptions.expectedAnnualReturnPercent >=
      required.requiredNominalReturnPercent

  const coreTotal =
    policy.coreTwEquityPercent +
    policy.coreGlobalEquityPercent +
    policy.coreBondCashPercent
  const allocationRows = [
    {
      layer: '核心',
      name: '台股大盤',
      percent: policy.coreTwEquityPercent,
      example: '0050、006208 或台股指數型基金',
    },
    {
      layer: '核心',
      name: '美股/全球',
      percent: policy.coreGlobalEquityPercent,
      example: 'VT、VOO、VTI 或全球指數型基金',
    },
    {
      layer: '核心',
      name: '債券/現金',
      percent: policy.coreBondCashPercent,
      example: 'BND、短期美債',
    },
    {
      layer: '衛星',
      name: '台股 + 美股個股',
      percent: policy.satellitePercent,
      example: `依個股研究卡；目前學習階段上限 ${learning.satelliteCapPercent}%`,
    },
  ]

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">目標與政策</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        先設定財務自由目標、確認所需報酬是否實際，再把目標、風險與配置寫成投資政策並簽署。完整說明見手冊{' '}
        <Link to="/handbook/01" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          01 第一步
        </Link>{' '}
        與{' '}
        <Link to="/handbook/02" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          02 投資政策聲明
        </Link>
        。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="財務自由目標金額"
          value={Number.isFinite(projection.fireNumber) ? formatCurrency(projection.fireNumber, profile.currency) : '—'}
          hint={`年支出 ${formatCurrency(projection.targetAnnualExpenses, profile.currency)} ÷ 安全提領率`}
        />
        <StatCard
          label="依假設報酬預估達成"
          value={
            assumptions.monthlyExpenses <= 0
              ? '尚未設定目標'
              : projection.alreadyFire
                ? '已達成'
                : projection.yearsToFire === null
                  ? '50 年內無法達成'
                  : `約 ${formatYearsToFire(projection.yearsToFire)}`
          }
          hint={projection.targetDate ? formatDate(projection.targetDate) : undefined}
        />
        <StatCard
          label={`${policy.targetYears} 年所需年化報酬`}
          value={requiredText}
          hint={FEASIBILITY_LABELS[required.feasibility]}
        />
        <StatCard
          label="目前假設報酬"
          value={`${assumptions.expectedAnnualReturnPercent}%`}
          hint={
            required.requiredNominalReturnPercent === null
              ? undefined
              : meetsAssumption
                ? '假設報酬已足以在目標年限內達成'
                : '假設報酬不足，需要提高儲蓄或延長年限'
          }
        />
      </div>

      {(required.feasibility === 'unrealistic' ||
        required.feasibility === 'unreachable') && (
        <p className="mt-4 rounded-md bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-900/30 dark:text-orange-200">
          所需報酬過高。依投資政策原則，應先調整槓桿最小的變數：提高儲蓄率 →
          延長年限 → 降低支出，最後才考慮提高風險。
        </p>
      )}

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">財務自由試算</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          填寫現況與假設（修改後自動儲存）。每月支出也用來計算緊急預備金目標。
        </p>
        <div className="mt-4">
          <NetWorthProjectionChart
            points={projection.points}
            fireNumber={projection.fireNumber}
            currency={profile.currency}
          />
        </div>
        <div className="mt-6">
          <AssumptionsForm />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          策略資產配置
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="py-2 pr-4">層級</th>
                <th className="py-2 pr-4">類別</th>
                <th className="py-2 pr-4">目標</th>
                <th className="py-2 pr-4">工具範例</th>
              </tr>
            </thead>
            <tbody>
              {allocationRows.map((row) => (
                <tr
                  key={row.name}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-700"
                >
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {row.layer}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {row.name}
                  </td>
                  <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">
                    {row.percent}%
                  </td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {row.example}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          核心合計 {coreTotal}%。衛星上限依學習階段自動調整：目前是階段
          {learning.title}，上限 {learning.satelliteCapPercent}%；未使用的衛星額度按比例留在核心。
        </p>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          投資政策參數
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          修改後自動儲存。這些參數會套用在個股研究卡、投資組合風控與交易前檢核。
        </p>
        <div className="mt-4">
          <InvestmentPolicyForm />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          簽署投資政策聲明
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          確認目標、風險與配置都是你在冷靜時願意遵守的規則後簽署。簽署後只在每年 1 月或人生重大事件時修改；這是行動路線的步驟 1.4。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setInvestmentPolicy({ signedAt: todayIsoDate() })}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {policy.signedAt ? '重新簽署（年度檢討後）' : '我已確認，簽署投資政策聲明'}
          </button>
          {policy.signedAt && (
            <span className="text-sm text-indigo-700 dark:text-indigo-400">✓ 已於 {policy.signedAt} 簽署</span>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          策略原則
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          {PRINCIPLES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
