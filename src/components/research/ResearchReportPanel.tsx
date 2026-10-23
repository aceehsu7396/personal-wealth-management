import type { AutoResearch } from '../../lib/research/autoResearch'
import type { FairValues } from '../../lib/research/fundamentals'
import { MIN_ETF_TRADE_VALUE, MIN_ROE_PERCENT, priceZoneOf } from '../../lib/calculations/thesisScoring'
import { PriceZoneBadge } from '../ThesisEvaluationView'
import { Term } from '../Term'
import { inputClass } from '../forms/FormField'

// The automatic health check shown on a research card: numbers with a
// plain-language reading, so the user only has to judge.

type Tone = 'good' | 'neutral' | 'warn'

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-indigo-700 dark:text-indigo-400',
  neutral: 'text-gray-700 dark:text-gray-300',
  warn: 'text-orange-700 dark:text-orange-400',
}
const TONE_MARK: Record<Tone, string> = { good: '✓', neutral: '·', warn: '△' }

interface Metric {
  label: string
  term?: string
  value: string
  tone: Tone
  note?: string
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(d)}%`)
const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: d })
const yi = (v: number) => `${(v / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 億`

function Section({ title, metrics }: { title: string; metrics: Metric[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{title}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {metrics.map((m) => (
          <li key={m.label} className="flex flex-wrap items-baseline gap-x-2">
            <span className={`w-4 shrink-0 ${TONE_CLASS[m.tone]}`}>{TONE_MARK[m.tone]}</span>
            <span className="text-gray-600 dark:text-gray-400">{m.term ? <Term name={m.term}>{m.label}</Term> : m.label}</span>
            <span className={`font-medium ${TONE_CLASS[m.tone]}`}>{m.value}</span>
            {m.note && <span className="w-full pl-6 text-xs text-gray-500 dark:text-gray-400">{m.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StockReport({
  auto,
  fair,
  price,
  explainedFlags,
  onExplain,
}: {
  auto: AutoResearch
  fair: FairValues | null
  price: number | null
  explainedFlags: Record<string, string>
  onExplain?: (key: string, text: string) => void
}) {
  const s = auto.stock!
  const v = s.valuation
  const quality: Metric[] = [
    s.fScore
      ? {
          label: 'F 分數',
          term: 'F分數',
          value: `${s.fScore.score} / 9`,
          tone: s.fScore.score >= 7 ? 'good' : s.fScore.score >= 6 ? 'neutral' : 'warn',
          note: s.fScore.items.filter((i) => !i.passed).map((i) => `未通過：${i.label}（${i.detail}）`).join('；') || '9 項全部通過',
        }
      : { label: 'F 分數', term: 'F分數', value: '不適用', tone: 'neutral', note: '金融保險業的財報結構不同，改看 ROE 與淨值比' },
    { label: 'ROE（近四季）', term: 'ROE', value: pct(s.roe), tone: s.roe === null ? 'neutral' : s.roe >= 15 ? 'good' : s.roe >= MIN_ROE_PERCENT ? 'neutral' : 'warn' },
  ]
  if (s.grossMargin !== null) {
    quality.push({
      label: '毛利率',
      value: `${pct(s.grossMarginPrev)} → ${pct(s.grossMargin)}`,
      tone: s.grossMarginPrev !== null && s.grossMargin < s.grossMarginPrev - 2 ? 'warn' : s.grossMarginPrev !== null && s.grossMargin > s.grossMarginPrev ? 'good' : 'neutral',
      note: '去年同期 → 近四季',
    })
  }
  const growth: Metric[] = [
    { label: '營收 3 年年化成長', value: pct(s.revenueCagr3y), tone: s.revenueCagr3y === null ? 'neutral' : s.revenueCagr3y >= 10 ? 'good' : s.revenueCagr3y < 0 ? 'warn' : 'neutral' },
    { label: 'EPS 3 年年化成長', value: pct(s.epsCagr3y), tone: s.epsCagr3y === null ? 'neutral' : s.epsCagr3y >= 10 ? 'good' : s.epsCagr3y < 0 ? 'warn' : 'neutral' },
    { label: '近四季營收年增', term: '營收年增率', value: pct(s.revenueYoyTtm), tone: s.revenueYoyTtm === null ? 'neutral' : s.revenueYoyTtm < 0 ? 'warn' : 'good' },
    { label: 'EPS（近四季）', value: num(s.epsTtm), tone: (s.epsTtm ?? 0) > 0 ? 'neutral' : 'warn' },
  ]
  const safety: Metric[] = [
    {
      label: '負債比',
      value: pct(s.debtRatio),
      tone: s.isFinancial || s.debtRatio === null ? 'neutral' : s.debtRatio > 60 ? 'warn' : 'good',
      note: s.isFinancial ? '金融業負債比本來就高，正常' : undefined,
    },
  ]
  if (s.currentRatio !== null) safety.push({ label: '流動比率', value: num(s.currentRatio), tone: s.currentRatio < 1 ? 'warn' : 'good' })
  if (s.freeCashFlow.length > 0 && !s.isFinancial) {
    const negative = s.freeCashFlow.filter((f) => f.value < 0).length
    safety.push({
      label: '自由現金流',
      value: s.freeCashFlow.map((f) => `${f.year} ${yi(f.value)}`).join('、'),
      tone: negative === 0 ? 'good' : negative >= 2 ? 'warn' : 'neutral',
    })
  }
  const dividends: Metric[] = [
    { label: '連續配息', value: `${s.dividends.consecutiveYears} 年`, tone: s.dividends.consecutiveYears >= 5 ? 'good' : 'neutral' },
    { label: '近 12 個月現金股利', value: `${num(s.dividends.lastYearCash)} 元`, tone: 'neutral' },
    { label: '殖利率', term: '殖利率', value: pct(v.dividendYield, 2), tone: 'neutral' },
    {
      label: '配息率',
      value: pct(s.dividends.payoutRatio, 0),
      tone: s.dividends.payoutRatio !== null && s.dividends.payoutRatio > 100 ? 'warn' : 'neutral',
      note: s.dividends.payoutRatio !== null && s.dividends.payoutRatio > 100 ? '配息超過獲利，難以持續' : undefined,
    },
  ]
  const multiple = fair?.method === 'pb' ? v.pb : v.pe
  const zone = fair && price ? priceZoneOf(price, fair.bear, fair.base, fair.bull) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="品質" metrics={quality} />
        <Section title="成長" metrics={growth} />
        <Section title="財務安全" metrics={safety} />
        <Section title="股利" metrics={dividends} />
      </div>

      <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-900/40">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">估值（以自己近 {v.years} 年的{fair?.method === 'pb' ? '淨值比' : '本益比'}區間推算）</p>
        {multiple && (
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            <Term name={fair?.method === 'pb' ? '淨值比' : '本益比'}>{fair?.method === 'pb' ? '淨值比' : '本益比'}</Term> 目前 {num(multiple.current)}，
            位於 5 年區間第 {multiple.percentile ?? '—'} 百分位（第 20／50／80 百分位：{num(multiple.p20)}／{num(multiple.p50)}／{num(multiple.p80)}）
          </p>
        )}
        {fair ? (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
              {(
                [
                  ['悲觀', fair.bear],
                  ['基準', fair.base],
                  ['樂觀', fair.bull],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded bg-white p-2 dark:bg-gray-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{label}合理價</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{num(value)}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              現價 {num(price)}
              {zone && <PriceZoneBadge zone={zone} />}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {fair.method === 'pe'
                  ? `EPS ${num(s.epsTtm)} × 成長 ${fair.growthPercent}% × 本益比 ${fair.multiples.map((m) => num(m, 1)).join('／')}`
                  : `每股淨值 × 淨值比 ${fair.multiples.map((m) => num(m, 2)).join('／')}`}
              </span>
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-500">歷史資料不足，無法推算合理價。</p>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          <Term name="財報紅旗">財報紅旗</Term>
        </p>
        {s.redFlags.length === 0 ? (
          <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-400">✓ 沒有偵測到紅旗</p>
        ) : (
          <ul className="mt-1 space-y-2 text-sm">
            {s.redFlags.map((f) => (
              <li key={f.key}>
                <p className={explainedFlags[f.key]?.trim() ? 'text-gray-600 dark:text-gray-400' : 'text-orange-700 dark:text-orange-400'}>
                  {explainedFlags[f.key]?.trim() ? '✓' : '⚠'} {f.label}：{f.detail}
                </p>
                {onExplain ? (
                  <input
                    className={`${inputClass} mt-1 text-xs`}
                    placeholder="查過原因了嗎？寫下說明（例如：擴產備貨、客戶延長付款），留空視為未解釋"
                    value={explainedFlags[f.key] ?? ''}
                    onChange={(e) => onExplain(f.key, e.target.value)}
                  />
                ) : (
                  explainedFlags[f.key] && <p className="pl-4 text-xs text-gray-500">說明：{explainedFlags[f.key]}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EtfReport({ auto, maxDrawdownLimit }: { auto: AutoResearch; maxDrawdownLimit: number }) {
  const e = auto.etf!
  const returns: Metric[] = [
    { label: '近 1 年（含息）', term: '年化報酬', value: pct(e.returns.y1), tone: 'neutral' },
    { label: '近 3 年年化', term: '年化報酬', value: pct(e.returns.y3), tone: 'neutral' },
    { label: '近 5 年年化', term: '年化報酬', value: pct(e.returns.y5), tone: 'neutral' },
  ]
  const risk: Metric[] = [
    { label: '年化波動（3 年）', value: pct(e.volatility), tone: 'neutral' },
    {
      label: '最大回撤',
      term: '最大回撤',
      value: pct(e.maxDrawdown),
      tone: e.maxDrawdown !== null && -e.maxDrawdown > maxDrawdownLimit ? 'warn' : 'neutral',
      note: e.maxDrawdown !== null && -e.maxDrawdown > maxDrawdownLimit ? `超過投資政策可承受的 −${maxDrawdownLimit}%，部位要小` : undefined,
    },
    {
      label: '日均成交金額',
      value: `${num(e.avgTradeValue)} 億`,
      tone: e.avgTradeValue !== null && e.avgTradeValue < MIN_ETF_TRADE_VALUE ? 'warn' : 'good',
      note: e.avgTradeValue !== null && e.avgTradeValue < MIN_ETF_TRADE_VALUE ? '成交量小，買賣價差可能較大' : undefined,
    },
  ]
  const payout: Metric[] = [
    { label: '近 12 個月殖利率', term: '殖利率', value: pct(e.yieldTtm, 2), tone: 'neutral' },
    { label: '近 12 個月配息次數', value: `${e.distributions12m} 次`, tone: 'neutral' },
    { label: '連續配息', value: `${e.distributionYears} 年`, tone: e.distributionYears >= 5 ? 'good' : 'neutral' },
  ]
  const versus: Metric[] = e.vs0050
    ? [
        {
          label: '3 年年化超額報酬',
          value: e.vs0050.excess3y === null ? '—' : `${e.vs0050.excess3y > 0 ? '+' : ''}${e.vs0050.excess3y.toFixed(1)} 個百分點`,
          tone: e.vs0050.excess3y === null ? 'neutral' : e.vs0050.excess3y >= 0 ? 'good' : 'warn',
        },
        { label: '相關係數', value: num(e.vs0050.correlation), tone: 'neutral', note: '越接近 1 越像 0050；低相關才有分散效果' },
        { label: 'β', term: 'β值', value: num(e.vs0050.beta), tone: 'neutral', note: '大盤漲跌 1% 時，它平均漲跌幾 %' },
      ]
    : [{ label: '這就是 0050', value: '基準本身', tone: 'neutral' }]
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Section title={`報酬（${e.historyYears} 年資料）`} metrics={returns} />
      <Section title="風險與流動性" metrics={risk} />
      <Section title="配息" metrics={payout} />
      <Section title="與 0050 比較" metrics={versus} />
    </div>
  )
}

export function ResearchReportPanel({
  auto,
  fair,
  price,
  explainedFlags = {},
  onExplain,
  maxDrawdownLimit,
}: {
  auto: AutoResearch
  fair: FairValues | null
  price: number | null
  explainedFlags?: Record<string, string>
  onExplain?: (key: string, text: string) => void
  maxDrawdownLimit: number
}) {
  const asOf = auto.kind === 'etf' ? auto.etf?.asOf : auto.stock?.asOf
  return (
    <div className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">自動體檢</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {auto.kind === 'etf' ? '價格與配息' : '財報'}資料至 {asOf ?? '—'}・更新於 {auto.fetchedAt.slice(0, 10)}・來源 FinMind 公開資料
        </p>
      </div>
      {auto.kind === 'etf' ? (
        auto.etf ? <EtfReport auto={auto} maxDrawdownLimit={maxDrawdownLimit} /> : <p className="text-sm text-gray-500">價格資料不足。</p>
      ) : auto.stock ? (
        <StockReport auto={auto} fair={fair} price={price} explainedFlags={explainedFlags} onExplain={onExplain} />
      ) : (
        <p className="text-sm text-gray-500">財報資料不足，無法體檢（可能是新上市公司）。</p>
      )}
    </div>
  )
}
