import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { TradeReview } from '../../lib/storage/schema'
import { errorClass, inputClass, labelClass } from './FormField'

const schema = z.object({
  outcomeNote: z.string().trim().min(1, '請描述結果'),
  decisionQuality: z.coerce.number().int().min(1).max(5),
  lesson: z.string().trim(),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

const QUALITY_LABELS = [
  '1 流程很差',
  '2 流程有明顯缺陷',
  '3 普通',
  '4 流程良好',
  '5 流程完全照紀律',
]

interface Props {
  onSubmit: (review: TradeReview) => void
  onCancel: () => void
}

export function TradeReviewForm({ onSubmit, onCancel }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { outcomeNote: '', decisionQuality: 3, lesson: '' },
  })

  return (
    <form
      onSubmit={handleSubmit((v) =>
        onSubmit({ ...v, reviewedAt: new Date().toISOString().slice(0, 10) }),
      )}
      className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <label className="block sm:col-span-2">
        <span className={labelClass}>結果：賺/賠多少，和基準比較如何？</span>
        <textarea rows={2} className={inputClass} {...register('outcomeNote')} />
        {errors.outcomeNote && <p className={errorClass}>{errors.outcomeNote.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>決策品質（與結果分開評分）</span>
        <select className={inputClass} {...register('decisionQuality')}>
          {QUALITY_LABELS.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>學到什麼？要修改哪條規則？</span>
        <input type="text" className={inputClass} {...register('lesson')} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          完成檢討
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          取消
        </button>
      </div>
    </form>
  )
}
