import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TrendSchema, type MacroCheckIn } from '../../lib/storage/schema'
import { errorClass, inputClass, labelClass } from './FormField'

const signal = z.coerce.number().int().min(-1).max(1)

const schema = z.object({
  date: z.string().min(1, '請選擇日期'),
  growth: z.object({
    usPmi: TrendSchema,
    usEmployment: TrendSchema,
    twBusinessSignal: TrendSchema,
    twExportOrders: TrendSchema,
  }),
  inflation: z.object({ usCpi: TrendSchema, twCpi: TrendSchema }),
  liquidity: z.object({
    policyRate: signal,
    yieldCurve: signal,
    creditSpread: signal,
    centralBankBalanceSheet: signal,
    usDollar: signal,
  }),
  sentiment: z.object({
    valuation: signal,
    credit: signal,
    ipoHype: signal,
    media: signal,
    margin: signal,
    vix: signal,
  }),
  policyNote: z.string().optional(),
  note: z.string().optional(),
})

type FormInput = z.input<typeof schema>
export type MacroCheckInFormValues = Omit<MacroCheckIn, 'id' | 'createdAt'>

const TREND_OPTIONS = [
  { value: 'up', text: '改善／上升 ↑' },
  { value: 'flat', text: '持平 →' },
  { value: 'down', text: '惡化／下降 ↓' },
]

const LIQUIDITY_OPTIONS = [
  { value: '1', text: '寬鬆 +1' },
  { value: '0', text: '中性 0' },
  { value: '-1', text: '緊縮 −1' },
]

const SENTIMENT_OPTIONS = [
  { value: '1', text: '過熱 +1' },
  { value: '0', text: '正常 0' },
  { value: '-1', text: '恐慌 −1' },
]

const GROWTH_FIELDS = [
  { name: 'growth.usPmi', label: '美國製造業採購經理人指數' },
  { name: 'growth.usEmployment', label: '美國就業（非農、失業率趨勢）' },
  { name: 'growth.twBusinessSignal', label: '台灣景氣對策信號' },
  { name: 'growth.twExportOrders', label: '台灣外銷訂單/出口年增率' },
] as const

const INFLATION_FIELDS = [
  { name: 'inflation.usCpi', label: '美國消費者物價指數／核心個人消費支出物價' },
  { name: 'inflation.twCpi', label: '台灣消費者物價指數' },
] as const

const LIQUIDITY_FIELDS = [
  { name: 'liquidity.policyRate', label: '政策利率方向（降息＝寬鬆）' },
  { name: 'liquidity.yieldCurve', label: '殖利率曲線 10Y−2Y' },
  { name: 'liquidity.creditSpread', label: '高收益債信用利差（收斂＝寬鬆）' },
  { name: 'liquidity.centralBankBalanceSheet', label: '央行資產負債表（擴表＝寬鬆）' },
  { name: 'liquidity.usDollar', label: '美元指數（走弱＝寬鬆）' },
] as const

const SENTIMENT_FIELDS = [
  { name: 'sentiment.valuation', label: '大盤本益比歷史百分位' },
  { name: 'sentiment.credit', label: '發債與信用條件' },
  { name: 'sentiment.ipoHype', label: '新股上市／題材炒作熱度' },
  { name: 'sentiment.media', label: '媒體與周遭討論' },
  { name: 'sentiment.margin', label: '融資餘額變化' },
  { name: 'sentiment.vix', label: '恐慌指數 VIX（低於 13 過熱、高於 30 恐慌）' },
] as const

function blankDefaults(): FormInput {
  return {
    date: new Date().toISOString().slice(0, 10),
    growth: { usPmi: 'flat', usEmployment: 'flat', twBusinessSignal: 'flat', twExportOrders: 'flat' },
    inflation: { usCpi: 'flat', twCpi: 'flat' },
    liquidity: { policyRate: 0, yieldCurve: 0, creditSpread: 0, centralBankBalanceSheet: 0, usDollar: 0 },
    sentiment: { valuation: 0, credit: 0, ipoHype: 0, media: 0, margin: 0, vix: 0 },
    policyNote: '',
    note: '',
  }
}

interface Props {
  initialValues?: MacroCheckInFormValues
  onSubmit: (values: MacroCheckInFormValues) => void
  onCancel?: () => void
}

export function MacroCheckInForm({ initialValues, onSubmit, onCancel }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, MacroCheckInFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? blankDefaults(),
  })

  const submit = handleSubmit((values) => {
    onSubmit(values)
    if (!initialValues) reset(blankDefaults())
  })

  const section = (
    title: string,
    hint: string,
    fields: readonly { name: string; label: string }[],
    options: { value: string; text: string }[],
  ) => (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</legend>
      <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className={labelClass}>{f.label}</span>
            <select
              className={inputClass}
              {...register(f.name as Parameters<typeof register>[0])}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </fieldset>
  )

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>日期</span>
        <input type="date" className={inputClass} {...register('date')} />
        {errors.date && <p className={errorClass}>{errors.date.message}</p>}
      </label>

      {section('支柱一：成長', '相較 3–6 個月前的方向', GROWTH_FIELDS, TREND_OPTIONS)}
      {section('支柱一：通膨', '相較 3–6 個月前的方向', INFLATION_FIELDS, TREND_OPTIONS)}
      {section('支柱二：流動性', '+1 寬鬆、−1 緊縮', LIQUIDITY_FIELDS, LIQUIDITY_OPTIONS)}
      {section('支柱三：情緒溫度（馬克斯鐘擺）', '+1 過熱、−1 恐慌', SENTIMENT_FIELDS, SENTIMENT_OPTIONS)}

      <label className="block sm:col-span-2">
        <span className={labelClass}>政策面觀察（選填）：貨幣、財政、產業政策、地緣政治</span>
        <textarea rows={2} className={inputClass} {...register('policyNote')} />
      </label>

      <label className="block sm:col-span-2">
        <span className={labelClass}>備註（選填）</span>
        <input type="text" className={inputClass} {...register('note')} />
      </label>

      <div className="flex items-end gap-2 sm:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {initialValues ? '儲存修改' : '新增總經檢視'}
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
