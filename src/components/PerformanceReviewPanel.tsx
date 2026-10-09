import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAppStore } from '../lib/storage/appStore'
import { netFlowsBySleeve, summarizeAttribution } from '../lib/calculations/attribution'
import { SLEEVE_LABELS, type PortfolioRiskReport } from '../lib/calculations/portfolioRisk'
import { todayIsoDate } from '../lib/market/twse'
import { addMonths } from '../lib/calculations/disciplineScore'
import { SleeveSchema, type PerformanceReview, type Sleeve } from '../lib/storage/schema'
import { StatCard } from './StatCard'
import { errorClass, inputClass, labelClass } from './forms/FormField'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

const SLEEVES: Sleeve[] = ['core_tw', 'core_global', 'core_bond_cash', 'satellite_tw', 'satellite_us', 'satellite_fund']

const num = z.coerce.number()
const schema = z
  .object({
    periodStart: z.string().min(1, '請選擇日期'),
    periodEnd: z.string().min(1, '請選擇日期'),
    sleeves: z.array(
      z.object({ sleeve: SleeveSchema, startValue: num.min(0), endValue: num.min(0), netFlow: num }),
    ),
    benchmarkReturns: z.object({ tw: num, global: num, bondCash: num }),
    note: z.string().optional(),
  })
  .refine((v) => v.periodStart < v.periodEnd, {
    message: '結束日須晚於開始日',
    path: ['periodEnd'],
  })

type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>

function pct(fraction: number | null, digits = 1): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—'
  const v = fraction * 100
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function PerformanceReviewPanel({ report }: { report: PortfolioRiskReport }) {
  const reviews = useAppStore((s) => s.performanceReviews)
  const trades = useAppStore((s) => s.trades)
  const holdings = useAppStore((s) => s.holdings)
  const policy = useAppStore((s) => s.investmentPolicy)
  const meta = useAppStore((s) => s.portfolioMeta)
  const addPerformanceReview = useAppStore((s) => s.addPerformanceReview)
  const removePerformanceReview = useAppStore((s) => s.removePerformanceReview)

  const [formOpen, setFormOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const summary = summarizeAttribution(reviews, policy)
  const last = [...reviews].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1)

  function prefill(): FormInput {
    const end = todayIsoDate()
    const start = last?.periodEnd ?? addMonths(end, -3)
    const flows = netFlowsBySleeve(trades, holdings, start, end, meta.fxUsdTwd)
    return {
      periodStart: start,
      periodEnd: end,
      sleeves: SLEEVES.map((s) => ({
        sleeve: s,
        startValue: Math.round(last?.sleeves.find((r) => r.sleeve === s)?.endValue ?? 0),
        endValue: Math.round(report.sleeves.find((r) => r.sleeve === s)?.valueTwd ?? 0),
        netFlow: Math.round(flows[s]),
      })),
      benchmarkReturns: { tw: 0, global: 0, bondCash: 0 },
      note: '',
    }
  }

  const lagging = summary.consecutiveSatelliteLaggingYears

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          季度檢討
        </h2>
        {!formOpen && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            + 新增季度檢討
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        基準 = 全部放在核心 ETF、依投資政策的核心比例配置。配置效果檢驗總經傾斜，選股效果檢驗衛星個股。
      </p>

      {reviews.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="累積報酬對比基準"
            value={pct(summary.cumulativeReturn)}
            hint={`基準 ${pct(summary.cumulativeBenchmarkReturn)}`}
          />
          <StatCard label="最大回撤（季度）" value={pct(summary.maxDrawdown)} />
          <StatCard
            label="夏普比率"
            value={summary.sharpeRatio === null ? '—' : summary.sharpeRatio.toFixed(2)}
            hint={summary.sharpeRatio === null ? '至少 4 期才計算' : '年化'}
          />
          <StatCard
            label="衛星連續落後年數"
            value={`${lagging}`}
            hint={lagging >= 3 ? '已達 3 年：衛星比重降 10 個百分點' : '連續 3 年落後即縮減衛星'}
          />
        </div>
      )}

      {formOpen && (
        <ReviewForm
          defaults={prefill()}
          onCancel={() => setFormOpen(false)}
          onSubmit={(values) => {
            addPerformanceReview(values)
            setFormOpen(false)
          }}
        />
      )}

      {summary.periods.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="py-2 pr-4">期間</th>
                <th className="py-2 pr-4">組合</th>
                <th className="py-2 pr-4">基準</th>
                <th className="py-2 pr-4">配置效果</th>
                <th className="py-2 pr-4">選股效果</th>
                <th className="py-2 pr-4">衛星對比基準</th>
                <th className="py-2 pr-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {[...summary.periods].reverse().map((p) => (
                <tr
                  key={p.review.id}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-700"
                >
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {p.review.periodStart} ～ {p.review.periodEnd}
                  </td>
                  <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">
                    {pct(p.portfolioReturn)}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {pct(p.benchmarkReturn)}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {pct(p.allocationEffect, 2)}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {pct(p.selectionEffect, 2)}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {p.satelliteReturn === null
                      ? '—'
                      : `${pct(p.satelliteReturn)} / ${pct(p.satelliteBenchmarkReturn)}`}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {pendingDeleteId === p.review.id ? (
                      <span className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            removePerformanceReview(p.review.id)
                            setPendingDeleteId(null)
                          }}
                          className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                        >
                          確定刪除
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(p.review.id)}
                        className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                      >
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviews.length === 0 && !formOpen && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          每季結束後新增一筆：系統會帶入各層級目前市值與期間內的交易現金流，你只需要補上基準報酬。
        </p>
      )}
    </div>
  )
}

function ReviewForm({
  defaults,
  onSubmit,
  onCancel,
}: {
  defaults: FormInput
  onSubmit: (values: Omit<PerformanceReview, 'id' | 'createdAt'>) => void
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mt-4 space-y-4 rounded-md border border-gray-200 p-4 dark:border-gray-700"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>期間開始</span>
          <input type="date" className={inputClass} {...register('periodStart')} />
        </label>
        <label className="block">
          <span className={labelClass}>期間結束</span>
          <input type="date" className={inputClass} {...register('periodEnd')} />
          {errors.periodEnd && <p className={errorClass}>{errors.periodEnd.message}</p>}
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400">
              <th className="py-1 pr-2">層級</th>
              <th className="py-1 pr-2">期初市值</th>
              <th className="py-1 pr-2">期末市值</th>
              <th className="py-1 pr-2">淨投入（買 − 賣）</th>
            </tr>
          </thead>
          <tbody>
            {SLEEVES.map((s, i) => (
              <tr key={s}>
                <td className="py-1 pr-2 text-gray-700 dark:text-gray-300">{SLEEVE_LABELS[s]}</td>
                <td className="py-1 pr-2">
                  <input type="number" step="any" className={inputClass} {...register(`sleeves.${i}.startValue`)} />
                </td>
                <td className="py-1 pr-2">
                  <input type="number" step="any" className={inputClass} {...register(`sleeves.${i}.endValue`)} />
                </td>
                <td className="py-1 pr-2">
                  <input type="number" step="any" className={inputClass} {...register(`sleeves.${i}.netFlow`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>0050 含息報酬（%）</span>
          <input type="number" step="any" className={inputClass} {...register('benchmarkReturns.tw')} />
        </label>
        <label className="block">
          <span className={labelClass}>全球股市 VT 含息報酬，以新台幣計（%）</span>
          <input type="number" step="any" className={inputClass} {...register('benchmarkReturns.global')} />
        </label>
        <label className="block">
          <span className={labelClass}>債券/現金報酬（%）</span>
          <input type="number" step="any" className={inputClass} {...register('benchmarkReturns.bondCash')} />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>檢討筆記（選填）</span>
        <input type="text" className={inputClass} {...register('note')} />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          儲存季度檢討
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          取消
        </button>
      </div>
    </form>
  )
}
