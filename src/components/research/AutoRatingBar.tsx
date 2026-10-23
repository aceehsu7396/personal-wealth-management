import { OVERALL_LABELS, type AutoRating, type Tone } from '../../lib/research/rating'

const TONE_STYLE: Record<Tone, string> = {
  good: 'bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-800',
  neutral: 'bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600',
  warn: 'bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:ring-orange-800',
}
const TONE_MARK: Record<Tone, string> = { good: '✓', neutral: '·', warn: '△' }

const OVERALL_STYLE: Record<AutoRating['overall'], string> = {
  strong: 'bg-indigo-600 text-white',
  caution: 'bg-gray-600 text-white',
  weak: 'bg-orange-600 text-white',
}

// The watch rating: overall label plus one chip per dimension. `compact`
// (lists) shows marks only, with the reason on hover.
export function AutoRatingBar({ rating, compact = false }: { rating: AutoRating; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${OVERALL_STYLE[rating.overall]}`}>{OVERALL_LABELS[rating.overall]}</span>
      {rating.dimensions.map((d) => (
        <span
          key={d.key}
          title={`${d.label}：${d.reason}`}
          className={`rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${TONE_STYLE[d.tone]}`}
        >
          {TONE_MARK[d.tone]} {d.label}
          {!compact && <span className="ml-1 opacity-80">{d.reason}</span>}
        </span>
      ))}
    </div>
  )
}
