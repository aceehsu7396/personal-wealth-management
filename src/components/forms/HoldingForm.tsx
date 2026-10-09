import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CurrencySchema,
  FundTypeSchema,
  HoldingKindSchema,
  SleeveSchema,
  type FundType,
  type Holding,
  type StockThesis,
} from '../../lib/storage/schema'
import { SLEEVE_LABELS } from '../../lib/calculations/portfolioRisk'
import { FUND_TYPE_LABELS, suggestSleeve } from '../../lib/calculations/fundRules'
import { todayIsoDate } from '../../lib/market/twse'
import { errorClass, inputClass, labelClass } from './FormField'

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number().nonnegative('不可為負數').optional(),
)

const schema = z.object({
  kind: HoldingKindSchema,
  ticker: z.string().trim().min(1, '請輸入代號'),
  name: z.string().trim(),
  sleeve: SleeveSchema,
  currency: CurrencySchema,
  shares: z.coerce.number().nonnegative('不可為負數'),
  avgCost: z.coerce.number().nonnegative('不可為負數'),
  currentPrice: z.coerce.number().nonnegative('不可為負數'),
  sector: z.string().trim().optional(),
  thesisId: z.string().optional(),
  fundType: z.union([FundTypeSchema, z.literal('')]).optional(),
  expenseRatioPercent: optionalNumber,
  provider: z.string().trim().optional(),
  navDate: z.string().optional(),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>
export type HoldingFormValues = Omit<Holding, 'id' | 'createdAt'>

function blankDefaults(): FormInput {
  return {
    kind: 'security',
    ticker: '',
    name: '',
    sleeve: 'core_tw',
    currency: 'TWD',
    shares: '',
    avgCost: '',
    currentPrice: '',
    sector: '',
    thesisId: '',
    fundType: '',
    expenseRatioPercent: '',
    provider: '',
    navDate: todayIsoDate(),
  }
}

function toFormInput(h: HoldingFormValues): FormInput {
  return {
    ...h,
    kind: h.kind ?? 'security',
    sector: h.sector ?? '',
    thesisId: h.thesisId ?? '',
    fundType: h.fundType ?? '',
    expenseRatioPercent: h.expenseRatioPercent ?? '',
    provider: h.provider ?? '',
    navDate: h.priceUpdatedAt ?? todayIsoDate(),
  }
}

// Stock/ETF holdings and fund holdings share one record; the fund-only
// fields are dropped for stocks and the stock-only fields for funds.
function toValues(v: FormOutput): HoldingFormValues {
  const base = {
    ticker: v.ticker,
    name: v.name,
    sleeve: v.sleeve,
    currency: v.currency,
    shares: v.shares,
    avgCost: v.avgCost,
    currentPrice: v.currentPrice,
  }
  if (v.kind === 'fund') {
    return {
      ...base,
      kind: 'fund',
      fundType: v.fundType || undefined,
      expenseRatioPercent: v.expenseRatioPercent,
      provider: v.provider || undefined,
      priceUpdatedAt: v.navDate || undefined,
      // Explicit undefined clears stock fields when editing a converted holding.
      sector: undefined,
      thesisId: undefined,
    }
  }
  return {
    ...base,
    kind: 'security',
    sector: v.sector || undefined,
    thesisId: v.thesisId || undefined,
    fundType: undefined,
    expenseRatioPercent: undefined,
    provider: undefined,
  }
}

interface Props {
  theses: StockThesis[]
  initialValues?: HoldingFormValues
  onSubmit: (values: HoldingFormValues) => void
  onCancel?: () => void
}

export function HoldingForm({ theses, initialValues, onSubmit, onCancel }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ? toFormInput(initialValues) : blankDefaults(),
  })

  const kind = watch('kind')
  const isFundForm = kind === 'fund'

  const submit = handleSubmit((values) => {
    onSubmit(toValues(values))
    if (!initialValues) reset({ ...blankDefaults(), kind: values.kind })
  })

  // Picking a fund type (or changing currency) suggests a sleeve; the user
  // can still override it afterwards.
  function applySuggestion(fundType: string, currency: string) {
    if (!fundType) return
    setValue('sleeve', suggestSleeve(fundType as FundType, currency === 'USD' ? 'USD' : 'TWD'))
  }
  const fundTypeField = register('fundType')
  const currencyField = register('currency')

  const activeTheses = theses.filter((t) => t.status !== 'exited' || t.id === initialValues?.thesisId)
  const label = (security: string, fund: string) => (isFundForm ? fund : security)

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="flex gap-2 sm:col-span-3" role="radiogroup" aria-label="持有類型">
        {(
          [
            ['security', '股票／ETF'],
            ['fund', '基金'],
          ] as const
        ).map(([value, text]) => (
          <label
            key={value}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium ${
              kind === value
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'
            }`}
          >
            <input type="radio" value={value} className="sr-only" {...register('kind')} />
            {text}
          </label>
        ))}
      </div>

      <label className="block">
        <span className={labelClass}>{label('代號', '基金代碼')}</span>
        <input type="text" className={inputClass} {...register('ticker')} />
        {errors.ticker && <p className={errorClass}>{errors.ticker.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>{label('名稱', '基金名稱')}</span>
        <input type="text" className={inputClass} {...register('name')} />
      </label>
      {isFundForm && (
        <label className="block">
          <span className={labelClass}>基金類型</span>
          <select
            className={inputClass}
            {...fundTypeField}
            onChange={(e) => {
              void fundTypeField.onChange(e)
              applySuggestion(e.target.value, getValues('currency'))
            }}
          >
            <option value="">請選擇</option>
            {Object.entries(FUND_TYPE_LABELS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className={labelClass}>幣別</span>
        <select
          className={inputClass}
          {...currencyField}
          onChange={(e) => {
            void currencyField.onChange(e)
            if (isFundForm) applySuggestion(String(getValues('fundType') ?? ''), e.target.value)
          }}
        >
          <option value="TWD">新台幣</option>
          <option value="USD">美元</option>
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>配置層級{isFundForm && '（依基金類型建議，可調整）'}</span>
        <select className={inputClass} {...register('sleeve')}>
          {Object.entries(SLEEVE_LABELS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>{label('股數（現金填金額）', '單位數')}</span>
        <input type="number" step="any" className={inputClass} {...register('shares')} />
        {errors.shares && <p className={errorClass}>{errors.shares.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>{label('平均成本（現金填 1）', '平均成本淨值')}</span>
        <input type="number" step="any" className={inputClass} {...register('avgCost')} />
        {errors.avgCost && <p className={errorClass}>{errors.avgCost.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>{label('現價（現金填 1）', '最新淨值')}</span>
        <input type="number" step="any" className={inputClass} {...register('currentPrice')} />
        {errors.currentPrice && <p className={errorClass}>{errors.currentPrice.message}</p>}
      </label>

      {isFundForm ? (
        <>
          <label className="block">
            <span className={labelClass}>淨值日期</span>
            <input type="date" className={inputClass} {...register('navDate')} />
          </label>
          <label className="block">
            <span className={labelClass}>內扣費用率（%／年，選填）</span>
            <input type="number" step="0.01" className={inputClass} {...register('expenseRatioPercent')} />
            {errors.expenseRatioPercent && <p className={errorClass}>{errors.expenseRatioPercent.message}</p>}
          </label>
          <label className="block">
            <span className={labelClass}>基金公司／購買平台（選填）</span>
            <input type="text" placeholder="例如：元大投信、基富通" className={inputClass} {...register('provider')} />
          </label>
        </>
      ) : (
        <>
          <label className="block">
            <span className={labelClass}>產業（衛星用，選填）</span>
            <input type="text" className={inputClass} {...register('sector')} />
          </label>
          <label className="block">
            <span className={labelClass}>研究卡（衛星必填）</span>
            <select className={inputClass} {...register('thesisId')}>
              <option value="">（無）</option>
              {activeTheses.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ticker} {t.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <div className="flex items-end gap-2 sm:col-span-3">
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {initialValues ? '儲存修改' : isFundForm ? '新增基金' : '新增持股'}
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
