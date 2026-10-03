import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  LynchCategorySchema,
  MarketSchema,
  ThesisStatusSchema,
  type InvestmentPolicy,
  type StockThesis,
} from '../../lib/storage/schema'
import {
  evaluateThesis,
  FIVE_FORCE_LABELS,
  LYNCH_LABELS,
  POWER_LABELS,
} from '../../lib/calculations/thesisScoring'
import { ThesisEvaluationView } from '../ThesisEvaluationView'
import { errorClass, inputClass, labelClass } from './FormField'

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number().optional(),
)
const score = (min: number) => z.coerce.number().int().min(min).max(5)
const price = z.coerce.number().positive('須大於 0')

const schema = z
  .object({
    ticker: z.string().trim().min(1, '請輸入代號'),
    name: z.string().trim().min(1, '請輸入名稱'),
    market: MarketSchema,
    sector: z.string().trim().min(1, '請輸入產業'),
    lynchCategory: LynchCategorySchema,
    inCircleOfCompetence: z.boolean(),
    status: ThesisStatusSchema,
    thesis: z.string(),
    drivers: z.string(),
    killCriteria: z.string(),
    sources: z.string(),
    preMortem: z.string(),
    policyRisk: z.string().optional(),
    fiveForces: z.object({
      rivalry: score(1),
      newEntrants: score(1),
      substitutes: score(1),
      buyerPower: score(1),
      supplierPower: score(1),
    }),
    powers: z.object({
      scaleEconomies: score(0),
      networkEconomies: score(0),
      counterPositioning: score(0),
      switchingCosts: score(0),
      branding: score(0),
      corneredResource: score(0),
      processPower: score(0),
    }),
    fScore: z.coerce.number().int().min(0, '0–9').max(9, '0–9'),
    roicPercent: optionalNumber,
    waccPercent: optionalNumber,
    hasUnexplainedRedFlags: z.boolean(),
    fairValueBear: price,
    fairValueBase: price,
    fairValueBull: price,
    currentPrice: price,
    impliedGrowthPercent: optionalNumber,
    historicalGrowthPercent: optionalNumber,
    marginOfSafetyOverridePercent: optionalNumber,
  })
  .refine((v) => v.fairValueBear <= v.fairValueBase && v.fairValueBase <= v.fairValueBull, {
    message: '合理價須符合 悲觀 ≤ 基準 ≤ 樂觀',
    path: ['fairValueBase'],
  })

type FormInput = z.input<typeof schema>
export type StockThesisFormValues = Omit<StockThesis, 'id' | 'createdAt' | 'updatedAt'>

const MARKET_LABELS = { TW: '台股', US: '美股' }
const STATUS_LABELS = { watch: '觀察', holding: '持有', exited: '已出場' }

function blankDefaults(): FormInput {
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
    policyRisk: '',
    fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
    powers: {
      scaleEconomies: 0,
      networkEconomies: 0,
      counterPositioning: 0,
      switchingCosts: 0,
      branding: 0,
      corneredResource: 0,
      processPower: 0,
    },
    fScore: 6,
    roicPercent: '',
    waccPercent: '',
    hasUnexplainedRedFlags: false,
    fairValueBear: '',
    fairValueBase: '',
    fairValueBull: '',
    currentPrice: '',
    impliedGrowthPercent: '',
    historicalGrowthPercent: '',
    marginOfSafetyOverridePercent: '',
  }
}

function toFormInput(values: StockThesisFormValues): FormInput {
  const blankIfUndefined = (v: number | undefined) => (v === undefined ? '' : v)
  return {
    ...values,
    policyRisk: values.policyRisk ?? '',
    roicPercent: blankIfUndefined(values.roicPercent),
    waccPercent: blankIfUndefined(values.waccPercent),
    impliedGrowthPercent: blankIfUndefined(values.impliedGrowthPercent),
    historicalGrowthPercent: blankIfUndefined(values.historicalGrowthPercent),
    marginOfSafetyOverridePercent: blankIfUndefined(values.marginOfSafetyOverridePercent),
  }
}

const TEXT_FIELDS = [
  { name: 'thesis', label: '一句話論點：為什麼市場錯了，或低估了持續性？' },
  { name: 'drivers', label: '3 個關鍵驅動因素（可量化、可追蹤）' },
  { name: 'killCriteria', label: '失效條件：出現什麼就代表論點錯了' },
  { name: 'sources', label: '資訊來源（至少 3 個獨立來源）' },
  { name: 'preMortem', label: '事前驗屍：一年後虧 40%，最可能的原因？' },
  { name: 'policyRisk', label: '政策／地緣風險（選填）' },
] as const

const sectionTitle = 'text-sm font-semibold text-slate-900 dark:text-slate-100 sm:col-span-2'

interface Props {
  policy: InvestmentPolicy
  initialValues?: StockThesisFormValues
  onSubmit: (values: StockThesisFormValues) => void
  onCancel?: () => void
}

export function StockThesisForm({ policy, initialValues, onSubmit, onCancel }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, StockThesisFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ? toFormInput(initialValues) : blankDefaults(),
  })

  const live = schema.safeParse(watch())
  const evaluation = live.success
    ? evaluateThesis({ ...live.data, id: '', createdAt: '', updatedAt: '' }, policy)
    : null

  const scoreSelect = (name: string, label: string, min: number) => (
    <label key={name} className="block">
      <span className={labelClass}>{label}</span>
      <select className={inputClass} {...register(name as Parameters<typeof register>[0])}>
        {Array.from({ length: 6 - min }, (_, i) => i + min).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )

  const numberInput = (
    name: keyof FormInput,
    label: string,
    error?: string,
    step = 'any',
  ) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input type="number" step={step} className={inputClass} {...register(name)} />
      {error && <p className={errorClass}>{error}</p>}
    </label>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <h3 className={sectionTitle}>基本資料</h3>
      <label className="block">
        <span className={labelClass}>代號</span>
        <input type="text" className={inputClass} {...register('ticker')} />
        {errors.ticker && <p className={errorClass}>{errors.ticker.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>名稱</span>
        <input type="text" className={inputClass} {...register('name')} />
        {errors.name && <p className={errorClass}>{errors.name.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>市場</span>
        <select className={inputClass} {...register('market')}>
          {Object.entries(MARKET_LABELS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>產業</span>
        <input type="text" className={inputClass} {...register('sector')} />
        {errors.sector && <p className={errorClass}>{errors.sector.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>Lynch 類型</span>
        <select className={inputClass} {...register('lynchCategory')}>
          {Object.entries(LYNCH_LABELS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>狀態</span>
        <select className={inputClass} {...register('status')}>
          {Object.entries(STATUS_LABELS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" {...register('inCircleOfCompetence')} />
        <span className={labelClass}>在我的能力圈內（能用 3 句話說清楚它怎麼賺錢）</span>
      </label>

      <h3 className={sectionTitle}>投資論點</h3>
      {TEXT_FIELDS.map((f) => (
        <label key={f.name} className="block sm:col-span-2">
          <span className={labelClass}>{f.label}</span>
          <textarea rows={2} className={inputClass} {...register(f.name)} />
        </label>
      ))}

      <h3 className={sectionTitle}>產業結構：Porter 五力（5 = 對公司最有利）</h3>
      {Object.entries(FIVE_FORCE_LABELS).map(([k, label]) =>
        scoreSelect(`fiveForces.${k}`, label, 1),
      )}

      <h3 className={sectionTitle}>競爭優勢：7 Powers（0 = 沒有，5 = 非常強）</h3>
      {Object.entries(POWER_LABELS).map(([k, label]) => scoreSelect(`powers.${k}`, label, 0))}

      <h3 className={sectionTitle}>財務品質</h3>
      {numberInput('fScore', 'Piotroski F-Score（0–9）', errors.fScore?.message, '1')}
      {numberInput('roicPercent', 'ROIC 5 年平均（%，選填）')}
      {numberInput('waccPercent', 'WACC（%，選填）')}
      <label className="flex items-center gap-2">
        <input type="checkbox" {...register('hasUnexplainedRedFlags')} />
        <span className={labelClass}>有未解釋的財報紅旗</span>
      </label>

      <h3 className={sectionTitle}>價值評估</h3>
      {numberInput('fairValueBear', '悲觀合理價', errors.fairValueBear?.message)}
      {numberInput('fairValueBase', '基準合理價', errors.fairValueBase?.message)}
      {numberInput('fairValueBull', '樂觀合理價', errors.fairValueBull?.message)}
      {numberInput('currentPrice', '現價', errors.currentPrice?.message)}
      {numberInput('impliedGrowthPercent', '反向 DCF 隱含成長率（%，選填）')}
      {numberInput('historicalGrowthPercent', '過去 5 年實際成長率（%，選填）')}
      {numberInput('marginOfSafetyOverridePercent', '安全邊際覆寫（%，選填；留空依品質自動決定）')}

      {evaluation && (
        <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700 sm:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            即時評估
          </h3>
          <ThesisEvaluationView evaluation={evaluation} />
        </div>
      )}

      <div className="flex items-end gap-2 sm:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {initialValues ? '儲存修改' : '新增研究卡'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            取消
          </button>
        )}
      </div>
    </form>
  )
}

export { MARKET_LABELS, STATUS_LABELS }
