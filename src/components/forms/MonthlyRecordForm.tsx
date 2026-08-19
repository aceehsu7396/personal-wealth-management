import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { errorClass, inputClass, labelClass } from './FormField'

const investmentSchema = z.object({
  name: z.string().min(1, '請輸入項目名稱'),
  amount: z.coerce.number().nonnegative('金額不可為負數'),
})

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '請選擇月份'),
  salaryIncome: z.coerce.number().nonnegative('金額不可為負數'),
  dividendIncome: z.coerce.number().nonnegative('金額不可為負數'),
  generalExpense: z.coerce.number().nonnegative('金額不可為負數'),
  householdExpense: z.coerce.number().nonnegative('金額不可為負數'),
  mortgageExpense: z.coerce.number().nonnegative('金額不可為負數'),
  investments: z.array(investmentSchema),
  note: z.string().optional(),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

interface Props {
  initialValues?: FormOutput
  onSubmit: (values: FormOutput) => void
  onCancel?: () => void
}

function blankDefaults(month: string): FormInput {
  return {
    month,
    salaryIncome: 0,
    dividendIncome: 0,
    generalExpense: 0,
    householdExpense: 0,
    mortgageExpense: 0,
    investments: [],
    note: '',
  }
}

export function MonthlyRecordForm({ initialValues, onSubmit, onCancel }: Props) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? blankDefaults(currentMonth),
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'investments' })

  const submit = handleSubmit((values) => {
    onSubmit(values)
    if (!initialValues) {
      reset(blankDefaults(currentMonth))
    }
  })

  return (
    <form onSubmit={submit} className="space-y-6">
      <label className="block sm:max-w-xs">
        <span className={labelClass}>月份</span>
        <input type="month" className={inputClass} {...register('month')} />
        {errors.month && <p className={errorClass}>{errors.month.message}</p>}
      </label>

      <div>
        <h3 className={labelClass}>收入</h3>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>薪資收入</span>
            <input type="number" className={inputClass} {...register('salaryIncome')} />
            {errors.salaryIncome && <p className={errorClass}>{errors.salaryIncome.message}</p>}
          </label>
          <label className="block">
            <span className={labelClass}>股息收入</span>
            <input type="number" className={inputClass} {...register('dividendIncome')} />
            {errors.dividendIncome && (
              <p className={errorClass}>{errors.dividendIncome.message}</p>
            )}
          </label>
        </div>
      </div>

      <div>
        <h3 className={labelClass}>支出</h3>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className={labelClass}>一般消費</span>
            <input type="number" className={inputClass} {...register('generalExpense')} />
            {errors.generalExpense && (
              <p className={errorClass}>{errors.generalExpense.message}</p>
            )}
          </label>
          <label className="block">
            <span className={labelClass}>家庭消費</span>
            <input type="number" className={inputClass} {...register('householdExpense')} />
            {errors.householdExpense && (
              <p className={errorClass}>{errors.householdExpense.message}</p>
            )}
          </label>
          <label className="block">
            <span className={labelClass}>房貸</span>
            <input type="number" className={inputClass} {...register('mortgageExpense')} />
            {errors.mortgageExpense && (
              <p className={errorClass}>{errors.mortgageExpense.message}</p>
            )}
          </label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className={labelClass}>投資</h3>
          <button
            type="button"
            onClick={() => append({ name: '', amount: 0 })}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            + 新增投資項目
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {fields.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              本月尚未新增任何投資項目。
            </p>
          )}
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <label className="block flex-1">
                {index === 0 && <span className={labelClass}>項目名稱</span>}
                <input
                  type="text"
                  className={inputClass}
                  placeholder="例如：0050 定投"
                  {...register(`investments.${index}.name` as const)}
                />
                {errors.investments?.[index]?.name && (
                  <p className={errorClass}>{errors.investments[index]?.name?.message}</p>
                )}
              </label>
              <label className="block w-32">
                {index === 0 && <span className={labelClass}>金額</span>}
                <input
                  type="number"
                  className={inputClass}
                  {...register(`investments.${index}.amount` as const)}
                />
              </label>
              <button
                type="button"
                onClick={() => remove(index)}
                className={`text-xs font-medium text-red-600 hover:underline dark:text-red-400 ${
                  index === 0 ? 'mt-7' : 'mt-1'
                }`}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={labelClass}>備註（選填）</span>
        <input type="text" className={inputClass} {...register('note')} />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {initialValues ? '儲存修改' : '新增紀錄'}
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
