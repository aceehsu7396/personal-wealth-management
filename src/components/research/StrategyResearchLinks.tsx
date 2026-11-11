import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { useSignals } from '../../lib/research/useSignals'
import { evaluateThesis, VERDICT_LABELS } from '../../lib/calculations/thesisScoring'
import { buyDistanceOf } from '../../lib/research/signals'
import { researchBlocks, thesesForStrategy } from '../../lib/research/strategyLink'
import type { TradingStrategy } from '../../lib/storage/schema'
import { ActionBadge } from './SignalPanel'

const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

// Each symbol of a strategy card next to its research card: verdict, advice
// and distance to the buy point. A pass verdict or a review/exit advice is
// shown in red, because the pre-trade checklist stops a real-money entry.
export function StrategyResearchLinks({ strategy }: { strategy: TradingStrategy }) {
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const signalsFor = useSignals()
  const linked = thesesForStrategy(strategy, theses)
  if (linked.length === 0) return null

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">研究卡連動</p>
      <ul className="mt-1 divide-y divide-gray-100 text-xs dark:divide-gray-700">
        {linked.map(({ symbol, code, thesis, isStock }) => {
          if (!thesis) {
            return (
              <li key={symbol} className="flex flex-wrap items-center gap-2 py-1.5 text-gray-600 dark:text-gray-400">
                <span className="font-medium text-gray-900 dark:text-gray-100">{code}</span>
                {isStock ? (
                  <>
                    <span>尚無研究卡；實單前要先確認風險</span>
                    <Link to={`/research/stocks?new=${encodeURIComponent(code)}`} className={linkClass}>
                      寫研究卡
                    </Link>
                  </>
                ) : (
                  <span>ETF：依策略規則進出</span>
                )}
              </li>
            )
          }
          const report = thesis.auto ? signalsFor(thesis, evaluateThesis(thesis, policy)) : null
          const blocks = researchBlocks(thesis, report)
          return (
            <li key={symbol} className="py-1.5">
              <Link
                to={`/research/stocks?new=${encodeURIComponent(thesis.ticker)}`}
                className="flex flex-wrap items-center gap-2 text-gray-700 hover:underline dark:text-gray-300"
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {thesis.ticker} {thesis.name}
                </span>
                <span>結論：{thesis.verdict ? VERDICT_LABELS[thesis.verdict] : '待選'}</span>
                {report ? (
                  <>
                    <ActionBadge action={report.action} title={report.headline} />
                    <span>{buyDistanceOf(report, thesis.kind === 'etf').label}</span>
                  </>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">尚未體檢</span>
                )}
              </Link>
              {blocks.length > 0 && (
                <p className="mt-0.5 text-red-600 dark:text-red-400">{blocks.join('；')}。實單會被交易前檢核擋下。</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
