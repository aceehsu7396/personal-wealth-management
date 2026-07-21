import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../../lib/storage/appStore'
import { Field, inputClass } from './FormField'

const formSchema = z
  .object({
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

export function AssumptionsForm() {
  const assumptions = useAppStore((s) => s.assumptions)
  const setAssumptions = useAppStore((s) => s.setAssumptions)

  const {
    register,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
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
      setAssumptions(result.data)
    })
    return () => subscription.unsubscribe()
  }, [watch, setAssumptions])

  const savingsMode = watch('savingsMode')

  return (
    <form className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
