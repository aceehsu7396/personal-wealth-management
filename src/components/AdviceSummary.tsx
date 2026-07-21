import type { AdviceRuleResult } from '../lib/calculations/adviceRules'

interface Props {
  advice: AdviceRuleResult | null
  emptyMessage: string
}

export function AdviceSummary({ advice, emptyMessage }: Props) {
  if (!advice) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
  }

  return (
    <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
      <p>
        <span className="font-medium text-slate-900 dark:text-slate-100">再平衡：</span>
        {advice.rebalancingSuggestion}
      </p>
      <p>
        <span className="font-medium text-slate-900 dark:text-slate-100">定期定額：</span>
        {advice.dcaPacingSuggestion}
      </p>
      <p>
        <span className="font-medium text-slate-900 dark:text-slate-100">配置微調：</span>
        {advice.allocationTiltSuggestion}
      </p>
      <p className="text-slate-500 dark:text-slate-400">{advice.phaseNote}</p>
      <p className="text-slate-500 dark:text-slate-400">{advice.rateNote}</p>
      <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
        {advice.disclaimer}
      </p>
    </div>
  )
}
