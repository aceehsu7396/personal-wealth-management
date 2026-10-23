import { useCallback, useEffect, useState } from 'react'
import type { InvestmentPolicy, LynchCategory, StockThesis } from '../../lib/storage/schema'
import {
  evaluateThesis,
  FIVE_FORCE_LABELS,
  LYNCH_LABELS,
  POWER_LABELS,
  STATUS_LABELS,
  VERDICT_LABELS,
} from '../../lib/calculations/thesisScoring'
import { autoFairValues, buildAutoResearch, derivedFields, isStale, type AutoResearch } from '../../lib/research/autoResearch'
import { todayIsoDate } from '../../lib/market/twse'
import { describeAiError } from '../../lib/ai/client'
import { ThesisEvaluationView } from '../ThesisEvaluationView'
import { ResearchReportPanel } from '../research/ResearchReportPanel'
import { Term } from '../Term'
import { errorClass, inputClass, labelClass } from './FormField'

export type StockThesisFormValues = Omit<StockThesis, 'id' | 'createdAt' | 'updatedAt'>

type PowerKey = keyof StockThesis['powers']
type Verdict = NonNullable<StockThesis['verdict']>
type EtfRole = NonNullable<StockThesis['etfRole']>

const ETF_ROLE_LABELS: Record<EtfRole, string> = {
  core: '核心（長期持有的市場報酬）',
  trading: '交易部位（依策略進出）',
  defensive: '防守（降低波動、避險）',
  income: '收益（現金流）',
}

const VERDICT_STYLE: Record<Verdict, string> = {
  invest: 'bg-indigo-600 text-white',
  watch: 'bg-gray-600 text-white',
  pass: 'bg-orange-600 text-white',
}

const sectionTitle = 'text-sm font-semibold text-gray-900 dark:text-gray-100'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

const ZERO_POWERS: StockThesis['powers'] = {
  scaleEconomies: 0,
  networkEconomies: 0,
  counterPositioning: 0,
  switchingCosts: 0,
  branding: 0,
  corneredResource: 0,
  processPower: 0,
}

// The two strongest powers of a card, for the moat picker.
function topPowers(powers: StockThesis['powers']): { key: PowerKey | ''; score: number }[] {
  const ranked = (Object.entries(powers) as [PowerKey, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  return [0, 1].map((i) => (ranked[i] ? { key: ranked[i][0], score: ranked[i][1] } : { key: '', score: 3 }))
}

function blank(): StockThesisFormValues {
  return {
    ticker: '',
    name: '',
    market: 'TW',
    sector: '',
    lynchCategory: 'stalwart',
    inCircleOfCompetence: false,
    status: 'watch',
    thesis: '',
    drivers: '',
    killCriteria: '',
    sources: '',
    preMortem: '',
    policyRisk: '',
    fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
    powers: { ...ZERO_POWERS },
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
  // A new card started from the screener: identity fields filled in.
  prefill?: { ticker: string; name: string; sector: string; currentPrice?: number }
}

// A research card: the numbers come from the automatic health check
// (FinMind, no AI, no key); the user makes five judgements.
export function StockThesisForm({ policy, initialValues, onSubmit, onCancel, prefill }: Props) {
  const [v, setV] = useState<StockThesisFormValues>(() => {
    const base = initialValues ?? { ...blank(), ...(prefill ?? {}), currentPrice: prefill?.currentPrice ?? 0 }
    return { ...blank(), ...base }
  })
  const [moat, setMoat] = useState(() => topPowers(v.powers))
  const [status, setStatus] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  const [showAssumptions, setShowAssumptions] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Lynch category follows the automatic suggestion until the user picks one.
  const [lynchTouched, setLynchTouched] = useState(initialValues !== undefined)

  const set = <K extends keyof StockThesisFormValues>(key: K, value: StockThesisFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }))
  const isTw = v.market === 'TW'

  const runAuto = useCallback(async (code: string) => {
    if (!/^[0-9A-Z]{4,6}$/.test(code)) return setStatus({ loading: false, error: '請輸入台股代號（例如 2330、0050）' })
    setStatus({ loading: true, error: null })
    try {
      const auto = await buildAutoResearch(code, todayIsoDate())
      setV((prev) => ({
        ...prev,
        ticker: code,
        auto,
        kind: auto.kind,
        name: prev.name.trim() || auto.name,
        sector: prev.sector.trim() || auto.industry,
        currentPrice: auto.price ?? prev.currentPrice,
      }))
      if (auto.stock && !lynchTouched) set('lynchCategory', auto.stock.lynch)
      setStatus({ loading: false, error: null })
    } catch (e) {
      setStatus({ loading: false, error: describeAiError(e) })
    }
  }, [lynchTouched])

  // New cards from the screener, and cards with an old check, refresh on open.
  useEffect(() => {
    if (v.market === 'TW' && v.ticker && isStale(v.auto, todayIsoDate())) void runAuto(v.ticker.trim().toUpperCase())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- only when the card opens

  const auto: AutoResearch | undefined = isTw ? v.auto : undefined
  const powers = { ...ZERO_POWERS }
  for (const m of moat) if (m.key) powers[m.key] = m.score
  const merged: StockThesisFormValues = {
    ...v,
    powers,
    ...(auto ? derivedFields(auto, v.assumptions, v.explainedFlags) : {}),
  }
  const fair = auto ? autoFairValues(auto, v.assumptions) : null
  const evaluation = evaluateThesis({ ...merged, id: '', createdAt: '', updatedAt: '' }, policy)
  const isEtf = merged.kind === 'etf'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!merged.ticker.trim()) return setError('請輸入代號')
    if (!merged.name.trim()) return setError('請輸入名稱，或先按「自動帶入」')
    setError(null)
    onSubmit({ ...merged, ticker: merged.ticker.trim().toUpperCase(), verdictAt: merged.verdict ? merged.verdictAt ?? todayIsoDate() : undefined })
  }

  const numberField = (key: 'fScore' | 'fairValueBear' | 'fairValueBase' | 'fairValueBull' | 'currentPrice', label: string) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input type="number" step="any" className={inputClass} value={v[key] || ''} onChange={(e) => set(key, Number(e.target.value) || 0)} />
    </label>
  )

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Identity + automatic data */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={labelClass}>市場</span>
          <select className={inputClass} value={v.market} onChange={(e) => set('market', e.target.value as StockThesis['market'])}>
            <option value="TW">台股（自動帶入）</option>
            <option value="US">美股（手動）</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>代號</span>
          <input
            className={inputClass}
            value={v.ticker}
            onChange={(e) => set('ticker', e.target.value.toUpperCase())}
            onBlur={() => isTw && v.ticker && !v.auto && void runAuto(v.ticker.trim())}
            placeholder="2330 或 0050"
          />
        </label>
        <label className="block">
          <span className={labelClass}>名稱</span>
          <input className={inputClass} value={v.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>狀態</span>
          <select className={inputClass} value={v.status} onChange={(e) => set('status', e.target.value as StockThesis['status'])}>
            {Object.entries(STATUS_LABELS).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isTw && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={status.loading || !v.ticker}
            onClick={() => void runAuto(v.ticker.trim())}
            className="rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
          >
            {status.loading ? '讀取財報與股價中…' : v.auto ? '更新體檢' : '自動帶入'}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">免費資料（FinMind），不使用 AI、不需金鑰；財報、本益比區間、股利自動計算</span>
          {status.error && <span className="text-sm text-red-600 dark:text-red-400">{status.error}</span>}
        </div>
      )}

      {auto && (
        <ResearchReportPanel
          auto={auto}
          fair={fair}
          price={merged.currentPrice || auto.price}
          explainedFlags={v.explainedFlags}
          onExplain={(key, text) => set('explainedFlags', { ...v.explainedFlags, [key]: text })}
          maxDrawdownLimit={policy.maxDrawdownTolerancePercent}
        />
      )}

      {/* The five judgements */}
      <div className="rounded-md border-2 border-indigo-200 p-4 dark:border-indigo-900">
        <h3 className={sectionTitle}>你的判斷</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          數字已自動算好，這裡只需要你判斷。{isEtf ? '三個問題加上結論。' : '五個問題，最後一題是結論。'}
        </p>
        <div className="mt-4 space-y-4">
          {!isEtf && (
            <fieldset>
              <legend className={labelClass}>① 在你的能力圈內嗎？能用 3 句話說清楚它怎麼賺錢？</legend>
              <div className="mt-1 flex gap-4 text-sm">
                {[true, false].map((b) => (
                  <label key={String(b)} className="flex items-center gap-1">
                    <input type="radio" checked={v.inCircleOfCompetence === b} onChange={() => set('inCircleOfCompetence', b)} />
                    {b ? '是' : '否'}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {isEtf && (
            <label className="block">
              <span className={labelClass}>① 這檔 ETF 在組合中的用途</span>
              <select className={inputClass} value={v.etfRole ?? ''} onChange={(e) => set('etfRole', (e.target.value || undefined) as EtfRole | undefined)}>
                <option value="">請選擇</option>
                {Object.entries(ETF_ROLE_LABELS).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className={labelClass}>{isEtf ? '② 為什麼持有它（而不是 0050）？' : '② 一句話論點：為什麼市場低估了它？'}</span>
            <textarea rows={2} className={inputClass} value={v.thesis} onChange={(e) => set('thesis', e.target.value)} />
          </label>
          <label className="block">
            <span className={labelClass}>③ 失效條件：出現什麼就代表你錯了、要出場？</span>
            <textarea
              rows={2}
              className={inputClass}
              value={v.killCriteria}
              onChange={(e) => set('killCriteria', e.target.value)}
              placeholder={isEtf ? '例：連續 2 年落後 0050 超過 5 個百分點' : '例：連續兩季毛利率低於 50%；主要客戶轉單'}
            />
          </label>
          {!isEtf && (
            <fieldset>
              <legend className={labelClass}>
                ④ 護城河：它靠什麼長期維持獲利？選 1–2 項並評強弱（1 弱 – 5 強）
              </legend>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {moat.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <select
                      className={inputClass}
                      value={m.key}
                      onChange={(e) => setMoat(moat.map((x, j) => (j === i ? { ...x, key: e.target.value as PowerKey | '' } : x)))}
                    >
                      <option value="">{i === 0 ? '（沒有明顯護城河）' : '（第二項，選填）'}</option>
                      {Object.entries(POWER_LABELS).map(([k, t]) => (
                        <option key={k} value={k} disabled={moat.some((x, j) => j !== i && x.key === k)}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <select
                      className={`${inputClass} w-20`}
                      value={m.score}
                      disabled={!m.key}
                      onChange={(e) => setMoat(moat.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)))}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend className={labelClass}>{isEtf ? '④' : '⑤'} 結論：值得投資嗎？</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(Object.keys(VERDICT_LABELS) as Verdict[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setV((prev) => ({ ...prev, verdict: k, verdictAt: todayIsoDate() }))}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    v.verdict === k ? VERDICT_STYLE[k] : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600'
                  }`}
                >
                  {VERDICT_LABELS[k]}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              className={`${inputClass} mt-2`}
              value={v.verdictNote}
              onChange={(e) => set('verdictNote', e.target.value)}
              placeholder="說明或需要調整的地方，例：品質好但偏貴，本益比回到中位數（約 23 倍）再分批買"
            />
          </fieldset>
        </div>
      </div>

      {/* Adjust the automatic valuation */}
      {auto?.stock && fair && (
        <div>
          <button type="button" onClick={() => setShowAssumptions((s) => !s)} className={linkClass}>
            {showAssumptions ? '收合' : '調整估值假設與分類'}
          </button>
          {showAssumptions && (
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-5 dark:bg-gray-900/40">
              {fair.method === 'pe' && (
                <label className="block">
                  <span className={labelClass}>EPS 成長率（%）</span>
                  <input
                    type="number"
                    step="0.5"
                    className={inputClass}
                    value={v.assumptions?.growthPercent ?? fair.growthPercent}
                    onChange={(e) => set('assumptions', { ...v.assumptions, growthPercent: Number(e.target.value) })}
                  />
                </label>
              )}
              {(['悲觀', '基準', '樂觀'] as const).map((label, i) => (
                <label key={label} className="block">
                  <span className={labelClass}>
                    {label}
                    {fair.method === 'pe' ? '本益比' : '淨值比'}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    className={inputClass}
                    value={(v.assumptions?.multiples ?? fair.multiples)[i]}
                    onChange={(e) => {
                      const m = [...(v.assumptions?.multiples ?? fair.multiples)] as [number, number, number]
                      m[i] = Number(e.target.value)
                      set('assumptions', { ...v.assumptions, multiples: m })
                    }}
                  />
                </label>
              ))}
              <label className="block">
                <span className={labelClass}>
                  <Term name="林區分類">林區分類</Term>
                </span>
                <select
                  className={inputClass}
                  value={v.lynchCategory}
                  onChange={(e) => {
                    setLynchTouched(true)
                    set('lynchCategory', e.target.value as LynchCategory)
                  }}
                >
                  {Object.entries(LYNCH_LABELS).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <p className="col-span-2 text-xs text-gray-500 sm:col-span-5 dark:text-gray-400">
                預設：成長率取 EPS 3 年年化成長（限制在 −10%～20%），本益比取近 5 年第 20／50／80 百分位。{' '}
                {v.assumptions && (
                  <button type="button" onClick={() => set('assumptions', undefined)} className={linkClass}>
                    恢復自動
                  </button>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Manual numbers: US stocks, or Taiwan without data */}
      {!auto && (
        <div>
          <h3 className={sectionTitle}>手動輸入數字</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {isTw ? '按「自動帶入」即可自動計算；讀不到資料時才需要手動輸入。' : '美股沒有自動資料，請依財報填寫。'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {numberField('fScore', 'F 分數（0–9）')}
            {numberField('fairValueBear', '悲觀合理價')}
            {numberField('fairValueBase', '基準合理價')}
            {numberField('fairValueBull', '樂觀合理價')}
            {numberField('currentPrice', '現價')}
            <label className="block">
              <span className={labelClass}>產業</span>
              <input className={inputClass} value={v.sector} onChange={(e) => set('sector', e.target.value)} />
            </label>
            <label className="block">
              <span className={labelClass}>林區分類</span>
              <select className={inputClass} value={v.lynchCategory} onChange={(e) => set('lynchCategory', e.target.value as LynchCategory)}>
                {Object.entries(LYNCH_LABELS).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 sm:col-span-3">
              <input type="checkbox" checked={v.hasUnexplainedRedFlags} onChange={(e) => set('hasUnexplainedRedFlags', e.target.checked)} />
              <span className={labelClass}>有未解釋的財報紅旗</span>
            </label>
          </div>
        </div>
      )}

      {/* Optional deeper research */}
      {!isEtf && (
        <div>
          <button type="button" onClick={() => setShowOptional((s) => !s)} className={linkClass}>
            {showOptional ? '收合選填項目' : '選填：五力分析、驅動因素、資訊來源、事前驗屍'}
          </button>
          {showOptional && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <fieldset className="sm:col-span-2">
                <legend className={labelClass}>波特五力（5 = 對公司最有利）</legend>
                <label className="mt-1 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={v.fiveForcesRated !== false} onChange={(e) => set('fiveForcesRated', e.target.checked)} />
                  我有評五力（勾選後列入檢核：平均 ≥ 3）
                </label>
                {v.fiveForcesRated !== false && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {(Object.entries(FIVE_FORCE_LABELS) as [keyof StockThesis['fiveForces'], string][]).map(([k, label]) => (
                      <label key={k} className="block">
                        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
                        <select className={inputClass} value={v.fiveForces[k]} onChange={(e) => set('fiveForces', { ...v.fiveForces, [k]: Number(e.target.value) })}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              {(
                [
                  ['drivers', '關鍵驅動因素（可追蹤的指標）'],
                  ['sources', '資訊來源'],
                  ['preMortem', '事前驗屍：一年後虧 40%，最可能的原因？'],
                  ['policyRisk', '政策／地緣風險'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className={labelClass}>{label}</span>
                  <textarea rows={2} className={inputClass} value={v[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">檢核結果</h3>
        <ThesisEvaluationView evaluation={evaluation} simple={isEtf} />
      </div>

      {error && <p className={errorClass}>{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {initialValues ? '儲存修改' : '新增研究卡'}
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

