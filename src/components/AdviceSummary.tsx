import type { AdviceRuleResult } from '../lib/calculations/adviceRules'

interface Props {
  advice: AdviceRuleResult | null
  emptyMessage: string
}

export function AdviceSummary({ advice, emptyMessage }: Props) {
  if (!advice) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
  }

  return (
    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
      <p>
        <span className="font-medium text-gray-900 dark:text-gray-100">再平衡：</span>
        {advice.rebalancingSuggestion}
      </p>
      <p>
        <span className="font-medium text-gray-900 dark:text-gray-100">定期定額：</span>
        {advice.dcaPacingSuggestion}
      </p>
      <p>
        <span className="font-medium text-gray-900 dark:text-gray-100">配置微調：</span>
        {advice.allocationTiltSuggestion}
      </p>
      <p className="text-gray-500 dark:text-gray-400">{advice.phaseNote}</p>
      <p className="text-gray-500 dark:text-gray-400">{advice.rateNote}</p>
      <p className="mt-3 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        {advice.disclaimer}
      </p>
    </div>
  )
}
