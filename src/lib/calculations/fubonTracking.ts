import {
  MacroSignalKeySchema,
  type DailyClose,
  type FubonOutlook,
  type MacroSignalKey,
  type TrackedIndex,
} from '../storage/schema'

export const MACRO_SIGNAL_LABELS: Record<MacroSignalKey, string> = {
  'growth.usPmi': '美國 ISM 製造業採購經理人指數',
  'growth.usEmployment': '美國就業（非農、失業率）',
  'growth.twBusinessSignal': '台灣景氣對策信號',
  'growth.twExportOrders': '台灣外銷訂單／出口',
  'inflation.usCpi': '美國 CPI／核心 PCE',
  'inflation.twCpi': '台灣 CPI',
  'liquidity.policyRate': '政策利率方向（Fed、台灣央行）',
  'liquidity.yieldCurve': '殖利率曲線 10Y−2Y',
  'liquidity.creditSpread': '高收益債信用利差',
  'liquidity.centralBankBalanceSheet': '央行資產負債表',
  'liquidity.usDollar': '美元指數',
  'sentiment.valuation': '大盤本益比歷史位置',
  'sentiment.credit': '信用條件',
  'sentiment.ipoHype': '新股上市／題材熱度',
  'sentiment.media': '媒體與周遭氛圍',
  'sentiment.margin': '融資餘額變化',
  'sentiment.vix': '恐慌指數 VIX',
}

export const PILLAR_LABELS: Record<string, string> = {
  growth: '成長',
  inflation: '通膨',
  liquidity: '流動性',
  sentiment: '情緒溫度',
}

export const TRACKED_INDEX_LABELS: Record<TrackedIndex, { label: string; unit: string }> = {
  taiex: { label: '台股加權指數', unit: '點' },
  sp500: { label: 'S&P 500', unit: '點' },
  stoxx600: { label: '歐股 Stoxx 600', unit: '點' },
  csi300: { label: '滬深 300', unit: '點' },
  us10y: { label: '美國 10 年期公債', unit: '%' },
  tw10y: { label: '台灣 10 年期公債', unit: '%' },
  cn10y: { label: '中國 10 年期公債', unit: '%' },
  dxy: { label: '美元指數', unit: '' },
  eurusd: { label: '歐元（EUR/USD）', unit: '' },
  usdjpy: { label: '日圓（USD/JPY）', unit: '' },
  usdcny: { label: '人民幣（USD/CNY）', unit: '' },
  usdtwd: { label: '新台幣（USD/TWD）', unit: '' },
}

export const TRACKED_INDICES = Object.keys(TRACKED_INDEX_LABELS) as TrackedIndex[]

// A digest older than this is considered stale: the market analysis then
// reads the latest PDF itself instead of relying on the digest.
export const OUTLOOK_FRESH_DAYS = 45

export function isOutlookFresh(outlook: FubonOutlook, today: string): boolean {
  const days = (Date.parse(today) - Date.parse(outlook.reportDate)) / 86_400_000
  return days >= 0 && days <= OUTLOOK_FRESH_DAYS
}

export function latestOutlook(outlooks: FubonOutlook[]): FubonOutlook | undefined {
  return [...outlooks].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0]
}

// Signals the digest does not fully cover; the market analysis searches
// the web only for these. Signals absent from the coverage list count too.
export function gapSignals(outlook: FubonOutlook): MacroSignalKey[] {
  const covered = new Set(outlook.coverage.filter((c) => c.status === 'covered').map((c) => c.signal))
  return MacroSignalKeySchema.options.filter((k) => !covered.has(k))
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function monthEndClose(history: DailyClose[], month: string): number | null {
  const inMonth = history.filter((d) => d.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))
  return inMonth.length > 0 ? inMonth[inMonth.length - 1].close : null
}

export type ForecastResult = 'hit' | 'miss' | 'nodata'

// Where an actual came from: the next Fubon report, or market data.
export type ActualSource = 'report' | 'market'

export interface ForecastEvaluation {
  month: string
  index: TrackedIndex
  low: number
  high: number
  actual: number | null
  source: ActualSource | null
  result: ForecastResult
}

export interface TrackingRow {
  index: TrackedIndex
  current: { low: number; high: number } | null
  // Latest market level (month to date), to compare with the current range.
  latest: { date: string; value: number } | null
  lastEvaluation: ForecastEvaluation | null
  hits: number
  evaluated: number
}

// Month-end closes per index (the last point of each month; the newest
// month may still be in progress). Built daily from free sources.
export type MarketCloses = Partial<Record<TrackedIndex, { date: string; value: number }[]>>

// The last close of each calendar month from daily points.
export function monthEndCloses(points: { date: string; value: number }[]): { date: string; value: number }[] {
  const byMonth = new Map<string, { date: string; value: number }>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) byMonth.set(p.date.slice(0, 7), p)
  return [...byMonth.values()]
}

// The close of `month` once that month is over (a later month exists).
function marketClose(closes: MarketCloses, index: TrackedIndex, month: string): number | null {
  const series = closes[index] ?? []
  const point = series.find((p) => p.date.slice(0, 7) === month)
  const done = series.some((p) => p.date.slice(0, 7) > month)
  return point && done ? point.value : null
}

// Each report forecasts the coming month and states last month's actual
// close. So report N's forecast is checked against report N+1's actuals,
// provided N+1 is the following month. Missing actuals come from market
// month-end closes (FRED, Yahoo Finance), and TAIEX also from TWSE history.
export function trackForecasts(
  outlooks: FubonOutlook[],
  taiexHistory: DailyClose[] = [],
  closes: MarketCloses = {},
): { rows: TrackingRow[]; evaluations: ForecastEvaluation[] } {
  const sorted = [...outlooks].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
  const evaluations: ForecastEvaluation[] = []

  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i]
    const next = sorted[i + 1]
    const month = monthOf(prev.reportDate)
    const nextIsFollowingMonth = next !== undefined && previousMonth(monthOf(next.reportDate)) === month
    for (const f of prev.forecasts) {
      let actual: number | null = null
      let source: ActualSource | null = null
      if (nextIsFollowingMonth) actual = next.actuals.find((a) => a.index === f.index)?.value ?? null
      if (actual !== null) source = 'report'
      if (actual === null) {
        actual = marketClose(closes, f.index, month)
        if (actual !== null) source = 'market'
      }
      if (actual === null && f.index === 'taiex') {
        // Only evaluate once the month is over (a later report exists or
        // history goes past the month).
        const monthDone = next !== undefined || taiexHistory.some((d) => d.date > `${month}-31`)
        if (monthDone) actual = monthEndClose(taiexHistory, month)
        if (actual !== null) source = 'market'
      }
      if (actual === null && !next) continue // current month: not evaluable yet
      evaluations.push({
        month,
        index: f.index,
        low: f.low,
        high: f.high,
        actual,
        source,
        result: actual === null ? 'nodata' : actual >= f.low && actual <= f.high ? 'hit' : 'miss',
      })
    }
  }

  const latest = sorted[sorted.length - 1]
  const rows: TrackingRow[] = TRACKED_INDICES.map((index) => {
    const mine = evaluations.filter((e) => e.index === index)
    const withData = mine.filter((e) => e.result !== 'nodata')
    const current = latest?.forecasts.find((f) => f.index === index)
    const series = closes[index]
    const last = series?.[series.length - 1]
    return {
      index,
      current: current ? { low: current.low, high: current.high } : null,
      latest: last ? { date: last.date, value: last.value } : null,
      lastEvaluation: mine[mine.length - 1] ?? null,
      hits: withData.filter((e) => e.result === 'hit').length,
      evaluated: withData.length,
    }
  })

  return { rows, evaluations }
}
