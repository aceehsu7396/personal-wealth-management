import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  InterestRateLevelSchema,
  MarketPhaseSchema,
  ValuationZoneSchema,
} from '../../lib/storage/schema'
import { errorClass, inputClass, labelClass } from './FormField'

const schema = z.object({
  date: z.string().min(1, '請選擇日期'),
  marketPhase: MarketPhaseSchema,
  valuationZone: ValuationZoneSchema,
  interestRateLevel: InterestRateLevelSchema,
  note: z.string().optional(),
})

export type MarketCheckInFormValues = z.infer<typeof schema>

const MARKET_PHASE_LABELS: Record<string, string> = {
  bull_early: '牛市初期',
  bull_late: '牛市末端',
  bear: '空頭市場',
  recovery: '回升初期',
  sideways: '盤整',
  unsure: '不確定',
}

const VALUATION_ZONE_LABELS: Record<string, string> = {
  undervalued: '低估',
  fair: '合理',
  overvalued: '高估',
  extremely_overvalued: '極度高估',
  unsure: '不確定',
}

const INTEREST_RATE_LABELS: Record<string, string> = {
  low: '偏低',
  neutral: '中性',
  high: '偏高',
  unsure: '不確定',
}

interface Props {
  initialValues?: MarketCheckInFormValues
  onSubmit: (values: MarketCheckInFormValues) => void
  onCancel?: () => void
}

export function MarketCheckInForm({ initialValues, onSubmit, onCancel }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MarketCheckInFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? {
      date: new Date().toISOString().slice(0, 10),
      marketPhase: 'unsure',
      valuationZone: 'unsure',
      interestRateLevel: 'unsure',
      note: '',
    },
  })

  const submit = handleSubmit((values) => {
    onSubmit(values)
    if (!initialValues) {
      reset({
        date: new Date().toISOString().slice(0, 10),
        marketPhase: 'unsure',
        valuationZone: 'unsure',
        interestRateLevel: 'unsure',
        note: '',
      })
    }
  })

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className="block">
        <span className={labelClass}>日期</span>
        <input type="date" className={inputClass} {...register('date')} />
        {errors.date && <p className={errorClass}>{errors.date.message}</p>}
      </label>

      <label className="block">
        <span className={labelClass}>市場階段</span>
        <select className={inputClass} {...register('marketPhase')}>
          {Object.entries(MARKET_PHASE_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClass}>估值區間</span>
        <select className={inputClass} {...register('valuationZone')}>
          {Object.entries(VALUATION_ZONE_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClass}>利率水準</span>
        <select className={inputClass} {...register('interestRateLevel')}>
          {Object.entries(INTEREST_RATE_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>

      <label className="block sm:col-span-2">
        <span className={labelClass}>備註（選填）</span>
        <input type="text" className={inputClass} {...register('note')} />
      </label>

      <div className="flex items-end gap-2 sm:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {initialValues ? '儲存修改' : '新增評估'}
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

export { MARKET_PHASE_LABELS, VALUATION_ZONE_LABELS, INTEREST_RATE_LABELS }
