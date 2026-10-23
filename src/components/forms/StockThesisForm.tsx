import { useCallback, useEffect, useState } from 'react'
import type { InvestmentPolicy, StockThesis } from '../../lib/storage/schema'
import { evaluateThesis, VERDICT_LABELS } from '../../lib/calculations/thesisScoring'
import { autoFairValues, buildAutoResearch, derivedFields, isStale, type AutoResearch } from '../../lib/research/autoResearch'
import { todayIsoDate } from '../../lib/market/twse'
import { describeAiError } from '../../lib/ai/client'
import { ThesisEvaluationView } from '../ThesisEvaluationView'
import { ResearchReportPanel } from '../research/ResearchReportPanel'
import { errorClass, inputClass, labelClass } from './FormField'

export type StockThesisFormValues = Omit<StockThesis, 'id' | 'createdAt' | 'updatedAt'>

type Verdict = NonNullable<StockThesis['verdict']>

const VERDICT_STYLE: Record<Verdict, string> = {
  invest: 'bg-indigo-600 text-white',
  watch: 'bg-gray-600 text-white',
  pass: 'bg-orange-600 text-white',
}

// Fields the scoring no longer reads but the stored card still carries.
function blank(): StockThesisFormValues {
  return {
    ticker: '',
    name: '',
    market: 'TW',
    sector: '',
    lynchCategory: 'stalwart',
    inCircleOfCompetence: true,
    status: 'watch',
    thesis: '',
    drivers: '',
    killCriteria: '',
    sources: '',
    preMortem: '',
    fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
    powers: { scaleEconomies: 0, networkEconomies: 0, counterPositioning: 0, switchingCosts: 0, branding: 0, corneredResource: 0, processPower: 0 },
    fScore: 0,
    hasUnexplainedRedFlags: false,
    fairValueBear: 0,
    fairValueBase: 0,
    fairValueBull: 0,
    currentPrice: 0,
    kind: 'stock',
    verdictNote: '',
    explainedFlags: {},
    fiveForcesRated: false,
  }
}

interface Props {
  policy: InvestmentPolicy
  initialValues?: StockThesisFormValues
  onSubmit: (values: StockThesisFormValues) => void
  onCancel?: () => void
  // A new card started from the screener.
  prefill?: { ticker: string; name: string; sector: string; currentPrice?: number }
}

// A research card is the automatic health check (FinMind, no AI, no key)
// plus a one-click verdict. Taiwan stocks and ETFs only.
export function StockThesisForm({ policy, initialValues, onSubmit, onCancel, prefill }: Props) {
  const [ticker, setTicker] = useState(initialValues?.ticker ?? prefill?.ticker ?? '')
  const [auto, setAuto] = useState<AutoResearch | undefined>(initialValues?.auto)
  const [verdict, setVerdict] = useState<Verdict | undefined>(initialValues?.verdict)
  const [verdictNote, setVerdictNote] = useState(initialValues?.verdictNote ?? '')
  const [status, setStatus] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  const [error, setError] = useState<string | null>(null)
  // Older cards for markets without automatic data (US) can only change the verdict.
  const legacy = initialValues !== undefined && initialValues.market !== 'TW'

  const runAuto = useCallback(async (code: string) => {
    const clean = code.trim().toUpperCase()
    if (!/^[0-9A-Z]{4,6}$/.test(clean)) return setStatus({ loading: false, error: '請輸入台股代號（例如 2330、0050）' })
    setStatus({ loading: true, error: null })
    try {
      setAuto(await buildAutoResearch(clean, todayIsoDate()))
      setTicker(clean)
      setStatus({ loading: false, error: null })
    } catch (e) {
      setStatus({ loading: false, error: describeAiError(e) })
    }
  }, [])

  // Open → check right away when there is no snapshot or it is a week old.
  useEffect(() => {
    if (!legacy && ticker && isStale(auto, todayIsoDate())) void runAuto(ticker)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- only when the card opens

  const base = { ...blank(), ...(initialValues ?? {}) }
  const values: StockThesisFormValues = auto
    ? {
        ...base,
        ticker: ticker.trim().toUpperCase(),
        market: 'TW',
        name: auto.name,
        sector: auto.industry,
        kind: auto.kind,
        auto,
        lynchCategory: auto.stock?.lynch ?? base.lynchCategory,
        assumptions: undefined,
        explainedFlags: {},
        ...derivedFields(auto, undefined, {}),
        verdict,
        verdictNote,
        verdictAt: verdict ? (verdict === initialValues?.verdict ? initialValues.verdictAt : todayIsoDate()) : undefined,
      }
    : { ...base, verdict, verdictNote, verdictAt: verdict ? todayIsoDate() : undefined }
  const evaluation = evaluateThesis({ ...values, id: '', createdAt: '', updatedAt: '' }, policy)
  const fair = auto ? autoFairValues(auto) : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!legacy && !auto) return setError('請先輸入代號並完成自動體檢')
    setError(null)
    onSubmit(values)
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {legacy ? (
        <p className="rounded-md bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-900/30 dark:text-orange-200">
          {initialValues?.ticker} {initialValues?.name}：這張是美股研究卡，目前沒有自動資料，只能更改結論；建議改用台股或 ETF。
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={labelClass}>台股或 ETF 代號</span>
            <input
              className={`${inputClass} w-40`}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runAuto(ticker)
                }
              }}
              placeholder="2330 或 0050"
            />
          </label>
          <button
            type="button"
            disabled={status.loading || !ticker}
            onClick={() => void runAuto(ticker)}
            className="rounded-md border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
          >
            {status.loading ? '讀取財報與股價中…' : auto ? '更新體檢' : '自動體檢'}
          </button>
          {auto && (
            <span className="pb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              {auto.name}・{auto.industry}・現價 {auto.price ?? '—'}
            </span>
          )}
          {status.error && <span className="pb-2 text-sm text-red-600 dark:text-red-400">{status.error}</span>}
        </div>
      )}

      {auto && <ResearchReportPanel auto={auto} fair={fair} price={auto.price} policy={policy} />}

      {(auto || legacy) && (
        <div className="rounded-md border-2 border-indigo-200 p-4 dark:border-indigo-900">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">你的結論</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">看完上面的自動指標，判斷值不值得投資。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(VERDICT_LABELS) as Verdict[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setVerdict(k)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  verdict === k
                    ? VERDICT_STYLE[k]
                    : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600'
                }`}
              >
                {VERDICT_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            className={`${inputClass} mt-2`}
            value={verdictNote}
            onChange={(e) => setVerdictNote(e.target.value)}
            placeholder="備註（選填）：例如「偏貴，等本益比回到中位數」"
          />
        </div>
      )}

      {(auto || legacy) && (
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
          <p className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">交易前檢核會看的項目</p>
          <ThesisEvaluationView evaluation={evaluation} simple={values.kind === 'etf' || !auto} />
        </div>
      )}

      {error && <p className={errorClass}>{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {initialValues ? '儲存' : '加入研究卡'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            取消
          </button>
        )}
      </div>
    </form>
  )
}
