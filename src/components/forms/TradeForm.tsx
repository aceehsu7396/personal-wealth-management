import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CurrencySchema,
  SleeveSchema,
  TradeReasonSchema,
  TradeSideSchema,
  type Trade,
} from '../../lib/storage/schema'
import {
  BUY_REASONS,
  buildPreTradeChecklist,
  SELL_REASONS,
  TRADE_REASON_LABELS,
  type ChecklistContext,
  type PendingTrade,
} from '../../lib/calculations/preTradeChecklist'
import { SLEEVE_LABELS } from '../../lib/calculations/portfolioRisk'
import { errorClass, inputClass, labelClass } from './FormField'

const schema = z.object({
  date: z.string().min(1, '請選擇日期'),
  side: TradeSideSchema,
  reason: TradeReasonSchema,
  holdingId: z.string(),
  ticker: z.string().trim(),
  name: z.string().trim(),
  sleeve: SleeveSchema,
  currency: CurrencySchema,
  thesisId: z.string(),
  shares: z.coerce.number().positive('須大於 0'),
  price: z.coerce.number().positive('須大於 0'),
  emotion: z.coerce.number().int().min(1).max(5),
  biasNotes: z.string(),
  manual: z.record(z.string(), z.boolean()),
  exceptionReason: z.string(),
})

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

export interface TradeSubmission {
  trade: Omit<Trade, 'id' | 'createdAt'>
  pending: PendingTrade
}

const BIAS_QUESTIONS = [
  '確認偏誤：最強的反方論點是什麼？',
  '錨定：合理價來自基本面，還是最近的股價？',
  '損失規避（賣出）：如果現在沒持有，這個價格我會買嗎？',
  '過度自信：如果錯了，損失在可承受範圍內嗎？',
  '從眾／錯失恐懼：是因為最近很多人在談才想買嗎？',
]

const EMOTION_LABELS = ['1 極度恐懼', '2 恐懼', '3 平靜', '4 貪婪', '5 極度貪婪']

function blankDefaults(): FormInput {
  return {
    date: new Date().toISOString().slice(0, 10),
    side: 'buy',
    reason: 'core_dca',
    holdingId: '',
    ticker: '',
    name: '',
    sleeve: 'core_tw',
    currency: 'TWD',
    thesisId: '',
    shares: '',
    price: '',
    emotion: 3,
    biasNotes: '',
    manual: {},
    exceptionReason: '',
  }
}

function toPending(v: FormOutput, ctx: ChecklistContext): PendingTrade {
  const holding = v.holdingId ? ctx.holdings.find((h) => h.id === v.holdingId) : undefined
  return {
    side: v.side,
    reason: v.reason,
    ticker: holding?.ticker ?? v.ticker,
    name: holding?.name ?? v.name,
    sleeve: holding?.sleeve ?? v.sleeve,
    currency: holding?.currency ?? v.currency,
    shares: v.shares,
    price: v.price,
    holdingId: holding?.id,
    thesisId: holding?.thesisId ?? (v.thesisId || undefined),
    biasNotes: v.biasNotes,
  }
}

interface Props {
  ctx: ChecklistContext
  onSubmit: (submission: TradeSubmission) => void
}

export function TradeForm({ ctx, onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: blankDefaults(),
  })

  const side = watch('side')
  const holdingId = watch('holdingId')
  const reason = watch('reason')
  const reasons = side === 'buy' ? BUY_REASONS : SELL_REASONS

  useEffect(() => {
    if (!reasons.includes(reason as never)) setValue('reason', reasons[0])
  }, [side, reason, reasons, setValue])

  const live = schema.safeParse(watch())
  const checklist = live.success
    ? buildPreTradeChecklist(toPending(live.data, ctx), ctx, live.data.manual)
    : []
  const failures = checklist.filter((c) => !c.passed)

  const submit = handleSubmit((values) => {
    const pending = toPending(values, ctx)
    if (!pending.ticker) {
      setError('ticker', { message: '請選擇持股或輸入代號' })
      return
    }
    const items = buildPreTradeChecklist(pending, ctx, values.manual)
    const hasFailures = items.some((c) => !c.passed)
    if (hasFailures && !values.exceptionReason.trim()) {
      setError('exceptionReason', { message: '有檢核項未通過：請寫下例外理由（會計入紀律分數）' })
      return
    }
    onSubmit({
      pending,
      trade: {
        date: values.date,
        ticker: pending.ticker,
        name: pending.name,
        holdingId: pending.holdingId,
        thesisId: pending.thesisId,
        side: values.side,
        reason: values.reason,
        shares: values.shares,
        price: values.price,
        currency: pending.currency,
        checklist: items.map(({ key, label, passed }) => ({ key, label, passed })),
        exceptionReason: hasFailures ? values.exceptionReason.trim() : undefined,
        emotion: values.emotion,
        biasNotes: values.biasNotes,
      },
    })
    reset(blankDefaults())
  })

  const holdingOptions = ctx.holdings.filter((h) => h.shares > 0 || h.id === holdingId)

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <label className="block">
        <span className={labelClass}>日期</span>
        <input type="date" className={inputClass} {...register('date')} />
        {errors.date && <p className={errorClass}>{errors.date.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>買／賣</span>
        <select className={inputClass} {...register('side')}>
          <option value="buy">買進</option>
          <option value="sell">賣出</option>
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>理由</span>
        <select className={inputClass} {...register('reason')}>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {TRADE_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>

      <label className="block sm:col-span-3">
        <span className={labelClass}>持股</span>
        <select className={inputClass} {...register('holdingId')}>
          {side === 'buy' && <option value="">（新標的）</option>}
          {side === 'sell' && <option value="">請選擇</option>}
          {holdingOptions.map((h) => (
            <option key={h.id} value={h.id}>
              {h.ticker} {h.name}（{SLEEVE_LABELS[h.sleeve]}，{h.shares} 股）
            </option>
          ))}
        </select>
      </label>

      {side === 'buy' && !holdingId && (
        <>
          <label className="block">
            <span className={labelClass}>代號</span>
            <input type="text" className={inputClass} {...register('ticker')} />
            {errors.ticker && <p className={errorClass}>{errors.ticker.message}</p>}
          </label>
          <label className="block">
            <span className={labelClass}>名稱</span>
            <input type="text" className={inputClass} {...register('name')} />
          </label>
          <label className="block">
            <span className={labelClass}>配置層級</span>
            <select className={inputClass} {...register('sleeve')}>
              {Object.entries(SLEEVE_LABELS).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>幣別</span>
            <select className={inputClass} {...register('currency')}>
              <option value="TWD">新台幣</option>
              <option value="USD">美元</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClass}>研究卡（衛星必填）</span>
            <select className={inputClass} {...register('thesisId')}>
              <option value="">（無）</option>
              {ctx.theses
                .filter((t) => t.status !== 'exited')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ticker} {t.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      <label className="block">
        <span className={labelClass}>股數</span>
        <input type="number" step="any" className={inputClass} {...register('shares')} />
        {errors.shares && <p className={errorClass}>{errors.shares.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>成交價</span>
        <input type="number" step="any" className={inputClass} {...register('price')} />
        {errors.price && <p className={errorClass}>{errors.price.message}</p>}
      </label>
      <label className="block">
        <span className={labelClass}>當下情緒</span>
        <select className={inputClass} {...register('emotion')}>
          {EMOTION_LABELS.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block sm:col-span-3">
        <span className={labelClass}>偏誤自問（衛星交易必填）</span>
        <ul className="mt-1 list-disc pl-5 text-xs text-slate-500 dark:text-slate-400">
          {BIAS_QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        <textarea rows={3} className={inputClass} {...register('biasNotes')} />
      </label>

      <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700 sm:col-span-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">交易前檢核</h3>
        {checklist.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">填入股數與成交價後顯示檢核結果。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {checklist.map((c) =>
              c.manual ? (
                <li key={c.key}>
                  <label className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                    <input type="checkbox" className="mt-1" {...register(`manual.${c.key}`)} />
                    <span>{c.label}</span>
                  </label>
                </li>
              ) : (
                <li
                  key={c.key}
                  className={c.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
                >
                  {c.passed ? '✓' : '✗'} {c.label}
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {failures.length > 0 && (
        <label className="block sm:col-span-3">
          <span className={labelClass}>例外理由（{failures.length} 項未通過）</span>
          <textarea rows={2} className={inputClass} {...register('exceptionReason')} />
          {errors.exceptionReason && <p className={errorClass}>{errors.exceptionReason.message}</p>}
        </label>
      )}

      <div className="sm:col-span-3">
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          記錄交易
        </button>
      </div>
    </form>
  )
}
