import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../../lib/storage/appStore'
import { Field, inputClass } from './FormField'

const percent = z.coerce.number().min(0, '不可為負數').max(100, '不可超過 100')

const formSchema = z
  .object({
    targetYears: z.coerce.number().min(1).max(50),
    coreTwEquityPercent: percent,
    coreGlobalEquityPercent: percent,
    coreBondCashPercent: percent,
    satellitePercent: percent,
    maxSinglePositionPercent: percent,
    maxHighConvictionPositionPercent: percent,
    maxSectorPercentOfSatellite: percent,
    maxUsdExposurePercent: percent,
    marginOfSafetyPercent: z.coerce.number().min(0).max(90),
    maxDrawdownTolerancePercent: percent,
    drawdownCircuitBreakerPercent: percent,
    reviewDrawdownFromCostPercent: percent,
  })
  .refine(
    (v) =>
      Math.abs(
        v.coreTwEquityPercent +
          v.coreGlobalEquityPercent +
          v.coreBondCashPercent +
          v.satellitePercent -
          100,
      ) < 0.01,
    {
      message: '核心三類 + 衛星的合計必須等於 100%',
      path: ['satellitePercent'],
    },
  )
  .refine(
    (v) => v.drawdownCircuitBreakerPercent <= v.maxDrawdownTolerancePercent,
    {
      message: '熔斷門檻應小於或等於最大回撤容忍度',
      path: ['drawdownCircuitBreakerPercent'],
    },
  )
  .refine(
    (v) => v.maxSinglePositionPercent <= v.maxHighConvictionPositionPercent,
    {
      message: '一般單檔上限應小於或等於高信心上限',
      path: ['maxSinglePositionPercent'],
    },
  )

type FormInput = z.input<typeof formSchema>
type FormOutput = z.output<typeof formSchema>

const FIELDS: { name: keyof FormOutput; label: string; step: string }[] = [
  { name: 'targetYears', label: '財務自由目標年限（年）', step: '1' },
  { name: 'coreTwEquityPercent', label: '核心：台股大盤 ETF（%）', step: '1' },
  {
    name: 'coreGlobalEquityPercent',
    label: '核心：美股/全球 ETF（%）',
    step: '1',
  },
  { name: 'coreBondCashPercent', label: '核心：債券/現金（%）', step: '1' },
  { name: 'satellitePercent', label: '衛星個股上限（%）', step: '1' },
  {
    name: 'maxSinglePositionPercent',
    label: '單檔個股上限（占總資產 %）',
    step: '0.5',
  },
  {
    name: 'maxHighConvictionPositionPercent',
    label: '高信心單檔上限（%）',
    step: '0.5',
  },
  {
    name: 'maxSectorPercentOfSatellite',
    label: '單一產業上限（占衛星 %）',
    step: '1',
  },
  { name: 'maxUsdExposurePercent', label: '美元資產上限（%）', step: '1' },
  { name: 'marginOfSafetyPercent', label: '預設安全邊際（%）', step: '1' },
  {
    name: 'maxDrawdownTolerancePercent',
    label: '最大回撤容忍度（%）',
    step: '1',
  },
  {
    name: 'drawdownCircuitBreakerPercent',
    label: '回撤熔斷門檻（%）',
    step: '1',
  },
  {
    name: 'reviewDrawdownFromCostPercent',
    label: '個股複查門檻：從成本下跌（%）',
    step: '1',
  },
]

export function InvestmentPolicyForm() {
  const policy = useAppStore((s) => s.investmentPolicy)
  const setInvestmentPolicy = useAppStore((s) => s.setInvestmentPolicy)

  const {
    register,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: Object.fromEntries(
      FIELDS.map((f) => [f.name, policy[f.name]]),
    ),
  })

  useEffect(() => {
    const subscription = watch((values) => {
      const result = formSchema.safeParse(values)
      if (!result.success) return
      setInvestmentPolicy(result.data)
    })
    return () => subscription.unsubscribe()
  }, [watch, setInvestmentPolicy])

  return (
    <form className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <Field key={f.name} label={f.label} error={errors[f.name]?.message}>
          <input
            type="number"
            step={f.step}
            className={inputClass}
            {...register(f.name)}
          />
        </Field>
      ))}
    </form>
  )
}
