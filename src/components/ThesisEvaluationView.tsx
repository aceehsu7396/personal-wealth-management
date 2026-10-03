import { PRICE_ZONE_LABELS, type ThesisEvaluation } from '../lib/calculations/thesisScoring'
import { formatPrice, formatRatio } from '../lib/format'

const ZONE_CLASSES: Record<string, string> = {
  strong_buy: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  buy: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  hold: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  trim: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  exit_overvalued: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export function PriceZoneBadge({ zone }: { zone: ThesisEvaluation['priceZone'] }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${ZONE_CLASSES[zone]}`}>
      {PRICE_ZONE_LABELS[zone]}
    </span>
  )
}

export function ThesisEvaluationView({ evaluation }: { evaluation: ThesisEvaluation }) {
  const metrics = [
    { label: '產業分數', value: evaluation.industryScore.toFixed(1), hint: '五力平均與最強競爭力量' },
    { label: '品質分數', value: evaluation.qualityScore.toFixed(1), hint: 'F 分數、投入資本報酬率、紅旗' },
    { label: '信心分數', value: evaluation.convictionScore.toFixed(1), hint: '1–5' },
    { label: '買進價', value: formatPrice(evaluation.buyPrice), hint: `安全邊際 ${evaluation.marginOfSafetyPercent}%` },
    { label: '期望價值', value: formatPrice(evaluation.expectedValue), hint: '25/50/25 加權' },
    { label: '上下檔比', value: formatRatio(evaluation.upsideDownsideRatio), hint: '≥ 2 才值得建倉' },
    {
      label: '建議部位',
      value: `${evaluation.targetPositionPercent}%`,
      hint: `上限 ${evaluation.positionCapPercent}%（占總資產）`,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PriceZoneBadge zone={evaluation.priceZone} />
        {evaluation.strongestPowers.length > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            競爭優勢：{evaluation.strongestPowers.join('、')}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-md bg-slate-50 p-3 dark:bg-slate-900/40">
            <dt className="text-xs text-slate-500 dark:text-slate-400">{m.label}</dt>
            <dd className="text-lg font-semibold text-slate-900 dark:text-slate-100">{m.value}</dd>
            <dd className="text-xs text-slate-500 dark:text-slate-400">{m.hint}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1 text-sm">
        {evaluation.checks.map((c) => (
          <li
            key={c.key}
            className={c.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
          >
            {c.passed ? '✓' : '✗'} {c.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
