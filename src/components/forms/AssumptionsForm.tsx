import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../../lib/storage/appStore'

const formSchema = z
  .object({
    currentAge: z.coerce.number().min(0).max(120),
    currency: z.string().min(1),
    currentNetWorth: z.coerce.number().min(0),
    monthlyIncome: z.coerce.number().min(0),
    savingsMode: z.enum(['amount', 'rate']),
    monthlySavingsAmount: z.coerce.number().min(0).optional(),
    savingsRatePercent: z.coerce.number().min(0).max(100).optional(),
    monthlyExpenses: z.coerce.number().min(0),
    expectedAnnualReturnPercent: z.coerce.number().min(-100).max(100),
    expectedInflationPercent: z.coerce.number().min(-100).max(100),
    safeWithdrawalRatePercent: z.coerce.number().min(0.1).max(100),
  })
  .refine(
    (data) =>
      data.savingsMode === 'amount'
        ? data.monthlySavingsAmount !== undefined
        : data.savingsRatePercent !== undefined,
    { message: '請填入對應的儲蓄金額或儲蓄率', path: ['savingsMode'] },
  )

type FormInput = z.input<typeof formSchema>
type FormOutput = z.output<typeof formSchema>

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const labelClass = 'text-sm font-medium text-slate-700 dark:text-slate-300'
const errorClass = 'mt-1 text-xs text-red-600 dark:text-red-400'

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {error && <p className={errorClass}>{error}</p>}
    </label>
  )
}

export function AssumptionsForm() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const setProfile = useAppStore((s) => s.setProfile)
  const setAssumptions = useAppStore((s) => s.setAssumptions)

  const {
    register,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      currentAge: profile.currentAge,
      currency: profile.currency,
      currentNetWorth: assumptions.currentNetWorth,
      monthlyIncome: assumptions.monthlyIncome,
      savingsMode: assumptions.savingsMode,
      monthlySavingsAmount: assumptions.monthlySavingsAmount,
      savingsRatePercent: assumptions.savingsRatePercent,
      monthlyExpenses: assumptions.monthlyExpenses,
      expectedAnnualReturnPercent: assumptions.expectedAnnualReturnPercent,
      expectedInflationPercent: assumptions.expectedInflationPercent,
      safeWithdrawalRatePercent: assumptions.safeWithdrawalRatePercent,
    },
  })

  useEffect(() => {
    const subscription = watch((values) => {
      const result = formSchema.safeParse(values)
      if (!result.success) return
      const v = result.data
      setProfile({ currentAge: v.currentAge, currency: v.currency })
      setAssumptions({
        currentNetWorth: v.currentNetWorth,
        monthlyIncome: v.monthlyIncome,
        savingsMode: v.savingsMode,
        monthlySavingsAmount: v.monthlySavingsAmount,
        savingsRatePercent: v.savingsRatePercent,
        monthlyExpenses: v.monthlyExpenses,
        expectedAnnualReturnPercent: v.expectedAnnualReturnPercent,
        expectedInflationPercent: v.expectedInflationPercent,
        safeWithdrawalRatePercent: v.safeWithdrawalRatePercent,
      })
    })
    return () => subscription.unsubscribe()
  }, [watch, setProfile, setAssumptions])

  const savingsMode = watch('savingsMode')

  return (
    <form className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field label="目前年齡" error={errors.currentAge?.message}>
        <input type="number" className={inputClass} {...register('currentAge')} />
      </Field>

      <Field label="幣別" error={errors.currency?.message}>
        <select className={inputClass} {...register('currency')}>
          <option value="TWD">TWD 新台幣</option>
          <option value="USD">USD 美元</option>
          <option value="JPY">JPY 日圓</option>
          <option value="HKD">HKD 港幣</option>
        </select>
      </Field>

      <Field label="目前淨資產" error={errors.currentNetWorth?.message}>
        <input type="number" className={inputClass} {...register('currentNetWorth')} />
      </Field>

      <Field label="月收入" error={errors.monthlyIncome?.message}>
        <input type="number" className={inputClass} {...register('monthlyIncome')} />
      </Field>

      <Field label="月支出" error={errors.monthlyExpenses?.message}>
        <input type="number" className={inputClass} {...register('monthlyExpenses')} />
      </Field>

      <Field label="儲蓄方式" error={errors.savingsMode?.message}>
        <div className="mt-1 flex gap-4 text-sm text-slate-700 dark:text-slate-300">
          <label className="flex items-center gap-1.5">
            <input type="radio" value="rate" {...register('savingsMode')} />
            依儲蓄率
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" value="amount" {...register('savingsMode')} />
            依固定金額
          </label>
        </div>
      </Field>

      {savingsMode === 'rate' ? (
        <Field label="儲蓄率（%）" error={errors.savingsRatePercent?.message}>
          <input
            type="number"
            step="0.1"
            className={inputClass}
            {...register('savingsRatePercent')}
          />
        </Field>
      ) : (
        <Field label="每月儲蓄金額" error={errors.monthlySavingsAmount?.message}>
          <input
            type="number"
            className={inputClass}
            {...register('monthlySavingsAmount')}
          />
        </Field>
      )}

      <Field
        label="預期年化報酬率（%）"
        error={errors.expectedAnnualReturnPercent?.message}
      >
        <input
          type="number"
          step="0.1"
          className={inputClass}
          {...register('expectedAnnualReturnPercent')}
        />
      </Field>

      <Field label="預期通膨率（%）" error={errors.expectedInflationPercent?.message}>
        <input
          type="number"
          step="0.1"
          className={inputClass}
          {...register('expectedInflationPercent')}
        />
      </Field>

      <Field
        label="安全提領率（%）"
        error={errors.safeWithdrawalRatePercent?.message}
      >
        <input
          type="number"
          step="0.1"
          className={inputClass}
          {...register('safeWithdrawalRatePercent')}
        />
      </Field>
    </form>
  )
}
