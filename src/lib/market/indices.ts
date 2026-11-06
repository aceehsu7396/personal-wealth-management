import { readCache, requestDataset, writeCache, type FinMindDataset, type Fetcher } from '../research/finmind'
import {
  applyFuturesCheck,
  catchUpFutures,
  expectedSessions,
  futuresReliability,
  futuresStart,
  type FuturesBar,
  type FuturesCheck,
  type FuturesReliability,
  type FuturesSession,
} from './futures'

// Daily closes of the Taiwan and US benchmark indexes (handbook chapter 05
// §6). FinMind serves them without a key and allows browser requests; the
// daily GitHub job (scripts/index-data.mts) also checks each one against an
// official source that blocks browsers, and adds TWSE market breadth.

export type IndexKey = 'TAIEX' | 'TAIEX_TR' | 'TPEx' | 'GSPC' | 'IXIC' | 'DJI' | 'SOX' | 'VIX' | 'SPY' | 'RSP'
export type IndexMarket = 'TW' | 'US'

export interface IndexDef {
  key: IndexKey
  name: string
  market: IndexMarket
  dataset: FinMindDataset
  id: string
  // Official source the daily job checks the close against.
  check: string | null
  // RSP and SPY only feed the breadth ratio; VIX is read by level.
  role: 'index' | 'volatility' | 'breadth'
}

export const INDEX_DEFS: IndexDef[] = [
  { key: 'TAIEX', name: '加權指數', market: 'TW', dataset: 'TaiwanStockPrice', id: 'TAIEX', check: '證交所', role: 'index' },
  { key: 'TAIEX_TR', name: '加權報酬指數', market: 'TW', dataset: 'TaiwanStockTotalReturnIndex', id: 'TAIEX', check: null, role: 'index' },
  { key: 'TPEx', name: '櫃買指數', market: 'TW', dataset: 'TaiwanStockPrice', id: 'TPEx', check: '櫃買中心', role: 'index' },
  { key: 'GSPC', name: 'S&P 500', market: 'US', dataset: 'USStockPrice', id: '^GSPC', check: 'FRED', role: 'index' },
  { key: 'IXIC', name: '那斯達克', market: 'US', dataset: 'USStockPrice', id: '^IXIC', check: 'FRED', role: 'index' },
  { key: 'DJI', name: '道瓊工業', market: 'US', dataset: 'USStockPrice', id: '^DJI', check: 'FRED', role: 'index' },
  { key: 'SOX', name: '費城半導體', market: 'US', dataset: 'USStockPrice', id: '^SOX', check: 'Yahoo Finance', role: 'index' },
  { key: 'VIX', name: 'VIX 恐慌指數', market: 'US', dataset: 'USStockPrice', id: '^VIX', check: 'FRED', role: 'volatility' },
  { key: 'SPY', name: 'SPY（市值加權）', market: 'US', dataset: 'USStockPrice', id: 'SPY', check: null, role: 'breadth' },
  { key: 'RSP', name: 'RSP（等權重）', market: 'US', dataset: 'USStockPrice', id: 'RSP', check: null, role: 'breadth' },
]

export const indexDef = (key: IndexKey) => INDEX_DEFS.find((d) => d.key === key)!

export interface IndexPoint {
  date: string
  close: number
}

export interface IndexCheck {
  source: string
  date: string
  official: number
  // FinMind's close on the same date, before any correction.
  primary: number | null
}

// Net buying (NT$) by the three institutional groups, whole market.
export interface FlowDay {
  date: string
  foreign: number
  trust: number
  dealer: number
}

// Margin purchase balance (NT$), whole market.
export interface MarginDay {
  date: string
  balance: number
}

// Advancing and declining common stocks on TWSE.
export interface Breadth {
  date: string
  up: number
  down: number
  unchanged: number
}

export interface IndicesData {
  generatedAt: string
  errors: string[]
  series: Partial<Record<IndexKey, IndexPoint[]>>
  checks: Partial<Record<IndexKey, IndexCheck>>
  breadth: Breadth | null
  flows: FlowDay[]
  margin: MarginDay[]
  // 台指期 day and night sessions; missing in snapshots before they existed.
  futures?: FuturesBar[]
  futuresCheck?: FuturesCheck | null
}

export const INDICES_DATA_PATH = 'data/indices.json'
// Four years: the 3-year chart still has its 200-day average from the start.
export const HISTORY_YEARS = 4
export const FLOW_DAYS = 60
// Above this gap the official close replaces FinMind's.
export const CHECK_TOLERANCE = 0.005

const round2 = (v: number) => Math.round(v * 100) / 100

// --- FinMind rows ----------------------------------------------------------

interface TwPriceRow {
  date: string
  close: number
}
interface UsPriceRow {
  date: string
  Close: number
}
interface ReturnIndexRow {
  date: string
  price: number
}
interface FlowRow {
  date: string
  name: string
  buy: number
  sell: number
}
interface MarginRow {
  date: string
  name: string
  TodayBalance: number
}

export function pointsFromRows(dataset: FinMindDataset, rows: unknown[]): IndexPoint[] {
  const pick = (r: unknown): IndexPoint => {
    if (dataset === 'USStockPrice') return { date: (r as UsPriceRow).date, close: (r as UsPriceRow).Close }
    if (dataset === 'TaiwanStockTotalReturnIndex') return { date: (r as ReturnIndexRow).date, close: (r as ReturnIndexRow).price }
    return { date: (r as TwPriceRow).date, close: (r as TwPriceRow).close }
  }
  return rows
    .map(pick)
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .map((p) => ({ date: p.date, close: round2(p.close) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const FLOW_GROUP: Record<string, keyof Omit<FlowDay, 'date'>> = {
  Foreign_Investor: 'foreign',
  Foreign_Dealer_Self: 'foreign',
  Investment_Trust: 'trust',
  Dealer_self: 'dealer',
  Dealer_Hedging: 'dealer',
}

export function flowsFromRows(rows: FlowRow[]): FlowDay[] {
  const byDate = new Map<string, FlowDay>()
  for (const r of rows) {
    const group = FLOW_GROUP[r.name]
    if (!group) continue
    const day = byDate.get(r.date) ?? { date: r.date, foreign: 0, trust: 0, dealer: 0 }
    day[group] += r.buy - r.sell
    byDate.set(r.date, day)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function marginFromRows(rows: MarginRow[]): MarginDay[] {
  return rows
    .filter((r) => r.name === 'MarginPurchaseMoney' && r.TodayBalance > 0)
    .map((r) => ({ date: r.date, balance: r.TodayBalance }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Later sources win on the same date.
export function mergeByDate<T extends { date: string }>(older: T[], newer: T[]): T[] {
  const byDate = new Map(older.map((p) => [p.date, p]))
  for (const p of newer) byDate.set(p.date, p)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// The official close replaces FinMind's when they disagree, or fills the
// day when FinMind has not published it yet.
export function applyCheck(points: IndexPoint[], check: IndexCheck | undefined): IndexPoint[] {
  if (!check) return points
  const own = points.find((p) => p.date === check.date)
  if (own && Math.abs(own.close / check.official - 1) <= CHECK_TOLERANCE) return points
  if (!own && points.length > 0 && check.date < points[points.length - 1].date) return points
  return mergeByDate(points, [{ date: check.date, close: check.official }])
}

// --- Trading days ----------------------------------------------------------

const MARKET_ZONE: Record<IndexMarket, { zone: string; readyMinutes: number }> = {
  // Closes 13:30; FinMind and TWSE publish within the hour.
  TW: { zone: 'Asia/Taipei', readyMinutes: 14 * 60 + 30 },
  // Closes 16:00 New York time.
  US: { zone: 'America/New_York', readyMinutes: 17 * 60 },
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}
const isWeekday = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

// The latest weekday whose close should already be published. Holidays are
// not known, so a single missing day is tolerated by staleness below.
export function expectedTradingDay(market: IndexMarket, now: Date = new Date()): string {
  const { zone, readyMinutes } = MARKET_ZONE[market]
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  let day = `${parts.year}-${parts.month}-${parts.day}`
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  if (!isWeekday(day) || minutes < readyMinutes) {
    do day = addDays(day, -1)
    while (!isWeekday(day))
  }
  return day
}

// Weekdays after `from` up to and including `to`.
export function weekdaysBetween(from: string, to: string): number {
  let n = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++
  return n
}

// --- Reliability -----------------------------------------------------------

export type ReliabilityStatus = 'verified' | 'mismatch' | 'stale' | 'unverified'

export interface Reliability {
  status: ReliabilityStatus
  label: string
  detail: string
}

const pctText = (v: number) => `${(v * 100).toFixed(2)}%`

export function reliabilityOf(points: IndexPoint[], check: IndexCheck | undefined, expected: string): Reliability {
  const last = points[points.length - 1]
  if (!last) return { status: 'stale', label: '沒有資料', detail: '主要與驗證來源都沒有讀到資料' }
  const behind = weekdaysBetween(last.date, expected)
  // One weekday is allowed for a holiday the calendar does not know.
  if (behind > 1) return { status: 'stale', label: '資料延遲', detail: `最新資料 ${last.date}，預期 ${expected}` }
  if (!check) return { status: 'unverified', label: '未驗證', detail: '只有 FinMind 一個來源' }
  if (check.primary === null) return { status: 'verified', label: '已驗證', detail: `${check.date} 收盤取自${check.source}` }
  const gap = Math.abs(check.primary / check.official - 1)
  if (gap <= CHECK_TOLERANCE) {
    return { status: 'verified', label: '已驗證', detail: `${check.date} 與${check.source}相差 ${pctText(gap)}` }
  }
  return {
    status: 'mismatch',
    label: '差異過大',
    detail: `${check.date} FinMind ${check.primary}、${check.source} ${check.official}，已改用${check.source}`,
  }
}

// --- Loading ---------------------------------------------------------------

const CACHE_KEY = 'pfm:indices:'

export const historyStart = (today: string, years = HISTORY_YEARS) => `${Number(today.slice(0, 4)) - years}${today.slice(4)}`

export async function fetchIndexPoints(def: IndexDef, start: string, fetcher?: Fetcher): Promise<IndexPoint[]> {
  return pointsFromRows(def.dataset, await requestDataset<unknown>(def.dataset, def.id, start, fetcher))
}

export async function fetchFlows(start: string, fetcher?: Fetcher): Promise<FlowDay[]> {
  return flowsFromRows(await requestDataset<FlowRow>('TaiwanStockTotalInstitutionalInvestors', '', start, fetcher))
}

export async function fetchMargin(start: string, fetcher?: Fetcher): Promise<MarginDay[]> {
  return marginFromRows(await requestDataset<MarginRow>('TaiwanStockTotalMarginPurchaseShortSale', '', start, fetcher))
}

// Fetches the days after `known` up to the expected trading day. A result
// that reaches it is cached for the day; an early one is retried next time.
async function catchUp<T extends { date: string }>(
  cacheKey: string,
  known: T[],
  expected: string,
  fullStart: string,
  fetch: (start: string) => Promise<T[]>,
): Promise<T[]> {
  const last = known[known.length - 1]?.date
  if (last && last >= expected) return known
  const key = `${CACHE_KEY}${cacheKey}:${expected}`
  const cached = readCache<T>(key)
  if (cached) return mergeByDate(known, cached)
  const fresh = await fetch(last ? addDays(last, -7) : fullStart)
  if (fresh.length > 0 && fresh[fresh.length - 1].date >= expected) writeCache(key, fresh)
  return mergeByDate(known, fresh)
}

export interface LoadedIndices extends IndicesData {
  expected: Record<IndexMarket, string>
  reliability: Partial<Record<IndexKey, Reliability>>
  futures: FuturesBar[]
  futuresExpected: Record<FuturesSession, string>
  futuresReliability: FuturesReliability
}

export async function fetchIndicesSnapshot(base: string = import.meta.env.BASE_URL): Promise<IndicesData | null> {
  try {
    const response = await fetch(`${base}${INDICES_DATA_PATH}`, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as IndicesData
  } catch {
    return null
  }
}

// The daily snapshot, topped up from FinMind when a market has closed
// since it was built (or when the snapshot is missing).
export async function loadIndices(
  snapshot: IndicesData | null,
  options: { now?: Date; fetcher?: Fetcher } = {},
): Promise<LoadedIndices> {
  const now = options.now ?? new Date()
  const expected = { TW: expectedTradingDay('TW', now), US: expectedTradingDay('US', now) }
  const fullStart = historyStart(isoDay(now))
  const errors = [...(snapshot?.errors ?? [])]
  const attempt = async <T>(label: string, fallback: T, task: () => Promise<T>): Promise<T> => {
    try {
      return await task()
    } catch (e) {
      errors.push(`${label}：${(e as Error).message}`)
      return fallback
    }
  }

  const series: Partial<Record<IndexKey, IndexPoint[]>> = {}
  const reliability: Partial<Record<IndexKey, Reliability>> = {}
  await Promise.all(
    INDEX_DEFS.map(async (def) => {
      const known = snapshot?.series[def.key] ?? []
      const points = await attempt(`FinMind ${def.name}`, known, () =>
        catchUp(def.key, known, expected[def.market], fullStart, (start) => fetchIndexPoints(def, start, options.fetcher)),
      )
      const check = snapshot?.checks[def.key]
      series[def.key] = applyCheck(points, check)
      reliability[def.key] = reliabilityOf(points, check, expected[def.market])
    }),
  )
  const flowStart = addDays(isoDay(now), -Math.round(FLOW_DAYS * 1.5))
  const futuresExpected = expectedSessions(now)
  const knownFutures = snapshot?.futures ?? []
  const futuresBars = await attempt('FinMind 台指期', knownFutures, () =>
    catchUpFutures(knownFutures, futuresExpected, futuresStart(isoDay(now)), options.fetcher),
  )
  const [flows, margin] = await Promise.all([
    attempt('FinMind 三大法人', snapshot?.flows ?? [], () =>
      catchUp('flows', snapshot?.flows ?? [], expected.TW, flowStart, (start) => fetchFlows(start, options.fetcher)),
    ),
    attempt('FinMind 融資餘額', snapshot?.margin ?? [], () =>
      catchUp('margin', snapshot?.margin ?? [], expected.TW, flowStart, (start) => fetchMargin(start, options.fetcher)),
    ),
  ])

  return {
    generatedAt: snapshot?.generatedAt ?? now.toISOString(),
    errors,
    series,
    checks: snapshot?.checks ?? {},
    breadth: snapshot?.breadth ?? null,
    flows,
    margin,
    expected,
    reliability,
    futures: applyFuturesCheck(futuresBars, snapshot?.futuresCheck),
    futuresCheck: snapshot?.futuresCheck ?? null,
    futuresExpected,
    futuresReliability: futuresReliability(futuresBars, snapshot?.futuresCheck, futuresExpected),
  }
}
