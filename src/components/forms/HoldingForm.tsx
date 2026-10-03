import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CurrencySchema,
  SleeveSchema,
  type Holding,
  type StockThesis,
} from '../../lib/storage/schema'
import { SLEEVE_LABELS } from '../../lib/calculations/portfolioRisk'
import { errorClass, inputClass, labelClass } from './FormField'

const schema = z.object({
  ticker: z.string().trim().min(1, '請輸入代號'),
  name: z.string().trim(),
  sleeve: SleeveSchema,
  currency: CurrencySchema,
  shares: z.coerce.number().nonnegative('不可為負數'),
  avgCost: z.coerce.number().nonnegative('不可為負數'),
  currentPrice: z.coerce.number().nonnegative('不可為負數'),
  sector: z.string().trim().optional(),
  thesisId: z.string().optional(),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>
export type HoldingFormValues = Omit<Holding, 'id' | 'createdAt' | 'priceUpdatedAt'>

function blankDefaults(): FormInput {
  return {
    ticker: '',
    name: '',
    sleeve: 'core_tw',
    currency: 'TWD',
    shares: '',
    avgCost: '',
    currentPrice: '',
    sector: '',
    thesisId: '',
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
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues
      ? { ...initialValues, sector: initialValues.sector ?? '', thesisId: initialValues.thesisId ?? '' }
      : blankDefaults(),
  })

  const submit = handleSubmit((values) => {
    onSubmit({
      ...values,
      sector: values.sector || undefined,
      thesisId: values.thesisId || undefined,
    })
    if (!initialValues) reset(blankDefaults())
  })

  const activeTheses = theses.filter((t) => t.status !== 'exited' || t.id === initialValues?.thesisId)

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <label className="block">
        <span className={labelClass}>代號</span>
        <input type="text" className={inputClass} {...register('ticker')} />
        {errors.ticker && <p className={errorClass}>{errors.ticker.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>名稱</span>
        <input type="text" className={inputClass} {...register('name')} />
      </label>
      <label className="block">
        <span className={labelClass}>配置層級</span>
        <select className={inputClass} {...register('sleeve')}>
          {Object.entries(SLEEVE_LABELS).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>幣別</span>
        <select className={inputClass} {...register('currency')}>
          <option value="TWD">TWD</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>股數（現金填金額）</span>
        <input type="number" step="any" className={inputClass} {...register('shares')} />
        {errors.shares && <p className={errorClass}>{errors.shares.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>平均成本（現金填 1）</span>
        <input type="number" step="any" className={inputClass} {...register('avgCost')} />
        {errors.avgCost && <p className={errorClass}>{errors.avgCost.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>現價（現金填 1）</span>
        <input type="number" step="any" className={inputClass} {...register('currentPrice')} />
        {errors.currentPrice && <p className={errorClass}>{errors.currentPrice.message}</p>}
      </label>
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

      <div className="flex items-end gap-2 sm:col-span-3">
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {initialValues ? '儲存修改' : '新增持股'}
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
