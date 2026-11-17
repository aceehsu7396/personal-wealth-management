import { useAppStore } from '../../lib/storage/appStore'
import { DEFAULT_DECISION_DAY, WEEKDAY_LABELS } from '../../lib/backtest/weekly'
import { Field, inputClass } from '../forms/FormField'

// The weekly decision day (handbook 10 §6.6): weekly strategy cards and
// comparisons decide at this day's close unless a card sets its own.
export function TradingPrefsCard() {
  const day = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay ?? DEFAULT_DECISION_DAY)
  const setDay = useAppStore((s) => s.setWeeklyDecisionDay)
  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">週頻交易</h2>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        週頻策略卡每週只在這一天收盤後判斷進出場，下個交易日開盤成交；停損每天照常。判斷日休市時，改用前一個交易日。策略卡可以另設自己的判斷日。
      </p>
      <div className="mt-4 w-48">
        <Field label="每週判斷日">
          <select className={inputClass} value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Object.entries(WEEKDAY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}收盤
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}
