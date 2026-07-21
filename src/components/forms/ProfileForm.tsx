import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../../lib/storage/appStore'
import { Field, inputClass } from './FormField'

const formSchema = z.object({
  currentAge: z.coerce.number().min(0).max(120),
  currency: z.string().min(1),
})

type FormInput = z.input<typeof formSchema>
type FormOutput = z.output<typeof formSchema>

export function ProfileForm() {
  const profile = useAppStore((s) => s.profile)
  const setProfile = useAppStore((s) => s.setProfile)

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
    },
  })

  useEffect(() => {
    const subscription = watch((values) => {
      const result = formSchema.safeParse(values)
      if (!result.success) return
      setProfile(result.data)
    })
    return () => subscription.unsubscribe()
  }, [watch, setProfile])

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
    </form>
  )
}
