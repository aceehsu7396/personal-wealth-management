import { useAppStore } from '../../lib/storage/appStore'
import { useJourney } from '../../lib/useJourney'
import { emergencyFundTarget, monthlyExpenseBaseline } from '../../lib/calculations/journey'
import { formatCurrency } from '../../lib/format'
import { inputClass, labelClass } from './FormField'

// Cash held outside the portfolio (roadmap step 1.2): the emergency fund now,
// widened to the living-cost buffer before leaving the day job.
export function EmergencyFundForm() {
  const setFoundation = useAppStore((s) => s.setFoundation)
  const { state } = useJourney()
  const baseline = monthlyExpenseBaseline(state)
  return (
    <>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        放在活存、貨幣市場或短債等隨時可動用的地方，不計入投資組合。每月支出取上方試算的數字：
        {formatCurrency(baseline, state.profile.currency)}。上班期間先備足目標月數；離開本業前要擴大到生活費緩衝月數。
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        <label className="block">
          <span className={labelClass}>全職前的生活費緩衝（月）</span>
          <input
            type="number"
            min="6"
            max="60"
            step="1"
            className={inputClass}
            defaultValue={state.foundation.livingBufferMonths}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 6) setFoundation({ livingBufferMonths: v })
            }}
          />
        </label>
      </div>
      <EmergencyFundBar />
    </>
  )
}

// Progress toward the emergency-fund target, also shown on the roadmap.
export function EmergencyFundBar() {
  const { state } = useJourney()
  const target = emergencyFundTarget(state)
  const fundPercent = target > 0 ? Math.min((state.foundation.emergencyFundAmount / target) * 100, 100) : 0
  return (
    <>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="h-full bg-indigo-600" style={{ width: `${fundPercent}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {formatCurrency(state.foundation.emergencyFundAmount, state.profile.currency)} /{' '}
        {formatCurrency(target, state.profile.currency)}（{fundPercent.toFixed(0)}%）
      </p>
    </>
  )
}
