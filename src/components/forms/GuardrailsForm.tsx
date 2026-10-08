import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../../lib/storage/appStore'
import { Field, inputClass } from './FormField'

const formSchema = z.object({
  rebalancingBandPercent: z.coerce.number().min(0).max(50),
  maxTiltPercent: z.coerce.number().min(0).max(50),
  minEquityFloorPercent: z.coerce.number().min(0).max(100),
})

type FormInput = z.input<typeof formSchema>
type FormOutput = z.output<typeof formSchema>

export function GuardrailsForm() {
  const guardrails = useAppStore((s) => s.guardrails)
  const setGuardrails = useAppStore((s) => s.setGuardrails)

  const {
    register,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      rebalancingBandPercent: guardrails.rebalancingBandPercent,
      maxTiltPercent: guardrails.maxTiltPercent,
      minEquityFloorPercent: guardrails.minEquityFloorPercent,
    },
  })

  useEffect(() => {
    const subscription = watch((values) => {
      const result = formSchema.safeParse(values)
      if (!result.success) return
      setGuardrails(result.data)
    })
    return () => subscription.unsubscribe()
  }, [watch, setGuardrails])

  return (
    <form className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field
        label="標準再平衡帶（%）"
        error={errors.rebalancingBandPercent?.message}
      >
        <input
          type="number"
          step="0.1"
          className={inputClass}
          {...register('rebalancingBandPercent')}
        />
      </Field>

      <Field label="配置微調上限（百分點）" error={errors.maxTiltPercent?.message}>
        <input
          type="number"
          step="0.1"
          className={inputClass}
          {...register('maxTiltPercent')}
        />
      </Field>

      <Field
        label="股票配置下限（%）"
        error={errors.minEquityFloorPercent?.message}
      >
        <input
          type="number"
          step="1"
          className={inputClass}
          {...register('minEquityFloorPercent')}
        />
      </Field>
    </form>
  )
}
