import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  date: z.string().min(1, '請選擇日期'),
  netWorthAmount: z.coerce.number(),
  note: z.string().optional(),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const labelClass = 'text-sm font-medium text-slate-700 dark:text-slate-300'
const errorClass = 'mt-1 text-xs text-red-600 dark:text-red-400'

interface Props {
  initialValues?: FormOutput
  onSubmit: (values: FormOutput) => void
  onCancel?: () => void
}

export function CheckInForm({ initialValues, onSubmit, onCancel }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues ?? {
      date: new Date().toISOString().slice(0, 10),
      netWorthAmount: 0,
      note: '',
    },
  })

  const submit = handleSubmit((values) => {
    onSubmit(values)
    if (!initialValues) {
      reset({ date: new Date().toISOString().slice(0, 10), netWorthAmount: 0, note: '' })
    }
  })

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <label className="block">
        <span className={labelClass}>日期</span>
        <input type="date" className={inputClass} {...register('date')} />
        {errors.date && <p className={errorClass}>{errors.date.message}</p>}
      </label>

      <label className="block">
        <span className={labelClass}>淨資產</span>
        <input type="number" className={inputClass} {...register('netWorthAmount')} />
        {errors.netWorthAmount && (
          <p className={errorClass}>{errors.netWorthAmount.message}</p>
        )}
      </label>

      <label className="block">
        <span className={labelClass}>備註（選填）</span>
        <input type="text" className={inputClass} {...register('note')} />
      </label>

      <div className="flex items-end gap-2 sm:col-span-3">
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
