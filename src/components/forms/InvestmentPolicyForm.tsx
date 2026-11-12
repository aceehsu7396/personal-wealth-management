import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../../lib/storage/appStore'
import { useJourney } from '../../lib/useJourney'
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
    riskPerTradePercent: z.coerce.number().min(0.1, '至少 0.1').max(5, '不建議超過 5'),
    maxOpenPositions: z.coerce.number().int().min(1).max(30),
    maxConsecutiveLosses: z.coerce.number().int().min(2, '至少 2').max(10),
    monthlyLossLimitPercent: z.coerce.number().min(1, '至少 1').max(20, '不建議超過 20'),
    targetVolatilityPercent: z.coerce.number().min(5).max(40),
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
      message: '核心三類 + 交易部位的合計必須等於 100%',
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

// Allocation fields carry tool examples, so the page needs no separate table.
const FIELDS: { name: keyof FormOutput; label: string; step: string; hint?: string }[] = [
  { name: 'targetYears', label: '財務獨立目標年限（年）', step: '1' },
  { name: 'coreTwEquityPercent', label: '核心：台股大盤（%）', step: '1', hint: '例：0050、006208 或台股指數型基金' },
  {
    name: 'coreGlobalEquityPercent',
    label: '核心：美股/全球（%）',
    step: '1',
    hint: '例：VT、VOO、VTI 或全球指數型基金',
  },
  { name: 'coreBondCashPercent', label: '核心：債券/現金（%）', step: '1', hint: '例：BND、短期美債' },
  {
    name: 'satellitePercent',
    label: '交易部位（衛星）上限（%）',
    step: '1',
    hint: '依策略卡交易；實際上限再受學習階段限制，未使用的額度按比例留在核心',
  },
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
    label: '單一產業上限（占交易部位額度 %）',
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
  { name: 'riskPerTradePercent', label: '每筆停損風險（占交易部位 %）', step: '0.1' },
  { name: 'maxOpenPositions', label: '交易部位最多同時持有（檔）', step: '1' },
  { name: 'maxConsecutiveLosses', label: '連續虧損幾筆就暫停新建倉', step: '1' },
  { name: 'monthlyLossLimitPercent', label: '單月虧損上限（占交易部位 %）', step: '0.5' },
  { name: 'targetVolatilityPercent', label: '部位目標波動度（年化 %）', step: '1' },
]

export function InvestmentPolicyForm() {
  const policy = useAppStore((s) => s.investmentPolicy)
  const { learning } = useJourney()
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
          {f.hint && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {f.hint}
              {f.name === 'satellitePercent' && `（目前階段${learning.title}，上限 ${learning.satelliteCapPercent}%）`}
            </p>
          )}
        </Field>
      ))}
    </form>
  )
}
