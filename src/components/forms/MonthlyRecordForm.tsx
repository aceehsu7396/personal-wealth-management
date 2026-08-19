import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { errorClass, inputClass, labelClass } from './FormField'

const lineItemSchema = z.object({
  name: z.string().min(1, '請輸入項目名稱'),
  amount: z.coerce.number().nonnegative('金額不可為負數'),
})

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '請選擇月份'),
  income: z.array(lineItemSchema),
  expenses: z.array(lineItemSchema),
  investments: z.array(lineItemSchema),
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
    income: [
      { name: '薪資收入', amount: 0 },
      { name: '股息收入', amount: 0 },
    ],
    expenses: [
      { name: '一般消費', amount: 0 },
      { name: '家庭消費', amount: 0 },
      { name: '房貸', amount: 0 },
    ],
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

  const income = useFieldArray({ control, name: 'income' })
  const expenses = useFieldArray({ control, name: 'expenses' })
  const investments = useFieldArray({ control, name: 'investments' })

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
        <div className="flex items-center justify-between">
          <h3 className={labelClass}>收入</h3>
          <button
            type="button"
            onClick={() => income.append({ name: '', amount: 0 })}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            + 新增收入項目
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {income.fields.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">尚未新增任何收入項目。</p>
          )}
          {income.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <label className="block flex-1">
                {index === 0 && <span className={labelClass}>項目名稱</span>}
                <input
                  type="text"
                  className={inputClass}
                  placeholder="例如：薪資收入"
                  {...register(`income.${index}.name` as const)}
                />
                {errors.income?.[index]?.name && (
                  <p className={errorClass}>{errors.income[index]?.name?.message}</p>
                )}
              </label>
              <label className="block w-32">
                {index === 0 && <span className={labelClass}>金額</span>}
                <input
                  type="number"
                  className={inputClass}
                  {...register(`income.${index}.amount` as const)}
                />
              </label>
              <button
                type="button"
                onClick={() => income.remove(index)}
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

      <div>
        <div className="flex items-center justify-between">
          <h3 className={labelClass}>支出</h3>
          <button
            type="button"
            onClick={() => expenses.append({ name: '', amount: 0 })}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            + 新增支出項目
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {expenses.fields.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">尚未新增任何支出項目。</p>
          )}
          {expenses.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <label className="block flex-1">
                {index === 0 && <span className={labelClass}>項目名稱</span>}
                <input
                  type="text"
                  className={inputClass}
                  placeholder="例如：一般消費"
                  {...register(`expenses.${index}.name` as const)}
                />
                {errors.expenses?.[index]?.name && (
                  <p className={errorClass}>{errors.expenses[index]?.name?.message}</p>
                )}
              </label>
              <label className="block w-32">
                {index === 0 && <span className={labelClass}>金額</span>}
                <input
                  type="number"
                  className={inputClass}
                  {...register(`expenses.${index}.amount` as const)}
                />
              </label>
              <button
                type="button"
                onClick={() => expenses.remove(index)}
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

      <div>
        <div className="flex items-center justify-between">
          <h3 className={labelClass}>投資</h3>
          <button
            type="button"
            onClick={() => investments.append({ name: '', amount: 0 })}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            + 新增投資項目
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {investments.fields.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              本月尚未新增任何投資項目。
            </p>
          )}
          {investments.fields.map((field, index) => (
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
                onClick={() => investments.remove(index)}
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
