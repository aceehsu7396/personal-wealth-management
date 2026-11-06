import { readCache, requestDataset, writeCache, type Fetcher } from '../research/finmind'

// TAIEX futures (台指期, TX), day and night sessions, for the market page.
// FinMind serves every contract without a key; the most traded outright
// contract of each session stands for the market. The daily job checks the
// latest session against TAIFEX's OpenAPI, which blocks browsers.
//
// TAIFEX dates a night session (盤後) by the trading day it belongs to: the
// night dated D runs from 15:00 of the previous trading day to 05:00 on D,
// and its change is measured from that day's settlement price.

export type FuturesSession = 'day' | 'night'

export interface FuturesBar {
  date: string
  session: FuturesSession
  // Contract month, e.g. 202611.
  contract: string
  open: number
  high: number
  low: number
  close: number
  // From the previous settlement price.
  change: number
  volume: number
}

export interface FuturesCheck {
  source: string
  date: string
  session: FuturesSession
  official: number
  // FinMind's close of the same session, before any correction.
  primary: number | null
}

export const FUTURES_ID = 'TX'
export const FUTURES_NAME = '台指期'
// A year of sessions for the 1-year chart.
export const FUTURES_HISTORY_DAYS = 400
// Night sessions end at 05:00; FinMind and TAIFEX publish soon after.
const NIGHT_READY_MINUTES = 5 * 60 + 30
// Day sessions end at 13:45.
const DAY_READY_MINUTES = 14 * 60 + 30
const CHECK_TOLERANCE = 0.005

interface FuturesRow {
  date: string
  contract_date: string
  open: number
  max: number
  min: number
  close: number
  spread: number
  volume: number
  trading_session: string
}

const SESSION_OF: Record<string, FuturesSession> = { position: 'day', after_market: 'night' }

// Night before day on the same date: that is the order they trade in.
export const sessionOrder = (a: FuturesBar, b: FuturesBar) =>
  a.date.localeCompare(b.date) || (a.session === b.session ? 0 : a.session === 'night' ? -1 : 1)

export function barsFromRows(rows: FuturesRow[]): FuturesBar[] {
  const best = new Map<string, FuturesRow>()
  for (const r of rows) {
    // Outright months only; spreads look like 202611/202612.
    if (!/^\d{6}$/.test(r.contract_date) || !SESSION_OF[r.trading_session] || !(r.volume > 0) || !(r.close > 0)) continue
    const key = `${r.date}|${r.trading_session}`
    const held = best.get(key)
    if (!held || r.volume > held.volume) best.set(key, r)
  }
  return [...best.values()]
    .map((r) => ({
      date: r.date,
      session: SESSION_OF[r.trading_session],
      contract: r.contract_date,
      open: r.open,
      high: r.max,
      low: r.min,
      close: r.close,
      change: r.spread,
      volume: r.volume,
    }))
    .sort(sessionOrder)
}

export function mergeBars(older: FuturesBar[], newer: FuturesBar[]): FuturesBar[] {
  const key = (b: FuturesBar) => `${b.date}|${b.session}`
  const byKey = new Map(older.map((b) => [key(b), b]))
  for (const b of newer) byKey.set(key(b), b)
  return [...byKey.values()].sort(sessionOrder)
}

export async function fetchFuturesBars(start: string, fetcher?: Fetcher): Promise<FuturesBar[]> {
  return barsFromRows(await requestDataset<FuturesRow>('TaiwanFuturesDaily', FUTURES_ID, start, fetcher))
}

// The official close replaces FinMind's when they disagree, or adds the
// session when FinMind has not published it yet.
export function applyFuturesCheck(bars: FuturesBar[], check: FuturesCheck | null | undefined): FuturesBar[] {
  if (!check) return bars
  const own = bars.find((b) => b.date === check.date && b.session === check.session)
  if (own && Math.abs(own.close / check.official - 1) <= CHECK_TOLERANCE) return bars
  if (own) return mergeBars(bars, [{ ...own, change: own.change + check.official - own.close, close: check.official }])
  return bars
}

// --- Session times ---------------------------------------------------------

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const isWeekday = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}
const nextWeekday = (iso: string) => {
  let d = addDays(iso, 1)
  while (!isWeekday(d)) d = addDays(d, 1)
  return d
}
const prevWeekday = (iso: string) => {
  let d = addDays(iso, -1)
  while (!isWeekday(d)) d = addDays(d, -1)
  return d
}

function taipeiNow(now: Date): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

// The latest session of each kind that should be published by now. A night
// that starts on a trading day W ends at 05:00 the next calendar day and is
// dated the trading day after W (Friday's night is dated Monday).
export function expectedSessions(now: Date = new Date()): Record<FuturesSession, string> {
  const { day, minutes } = taipeiNow(now)
  // The night that ended this morning started on the day before.
  const startedOn = minutes >= NIGHT_READY_MINUTES ? addDays(day, -1) : addDays(day, -2)
  const lastStart = isWeekday(startedOn) ? startedOn : prevWeekday(startedOn)
  const dayDate = isWeekday(day) && minutes >= DAY_READY_MINUTES ? day : prevWeekday(day)
  return { night: nextWeekday(lastStart), day: dayDate }
}

// "11/5 15:00–11/6 05:00": a night starts after the previous day session.
export function nightSpan(bars: FuturesBar[], bar: FuturesBar): string {
  const before = bars.filter((b) => b.session === 'day' && b.date < bar.date).at(-1)?.date ?? prevWeekday(bar.date)
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
  return `${md(before)} 15:00–${md(addDays(before, 1))} 05:00`
}

export const sessionLabel = (bars: FuturesBar[], bar: FuturesBar) =>
  bar.session === 'night' ? `夜盤 ${nightSpan(bars, bar)}` : `日盤 ${Number(bar.date.slice(5, 7))}/${Number(bar.date.slice(8, 10))}`

// --- Reading -----------------------------------------------------------------

export interface NightReading {
  bar: FuturesBar
  span: string
  changePct: number
  // Night close minus the latest TAIEX close before it.
  vsSpot: number | null
  spotDate: string | null
}

export function nightReading(bars: FuturesBar[], taiex: { date: string; close: number }[]): NightReading | null {
  const bar = bars.filter((b) => b.session === 'night').at(-1)
  if (!bar) return null
  const base = bar.close - bar.change
  const spot = taiex.filter((p) => p.date < bar.date).at(-1) ?? null
  return {
    bar,
    span: nightSpan(bars, bar),
    changePct: base > 0 ? (bar.change / base) * 100 : 0,
    vsSpot: spot ? bar.close - spot.close : null,
    spotDate: spot?.date ?? null,
  }
}

const int = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${int.format(Math.abs(v))}`

export function nightLine(r: NightReading): string {
  const pct = `${r.changePct > 0 ? '+' : r.changePct < 0 ? '−' : ''}${Math.abs(r.changePct).toFixed(2)}%`
  const spot =
    r.vsSpot === null
      ? ''
      : `，${r.vsSpot >= 0 ? '高於' : '低於'}加權指數（${r.spotDate?.slice(5)}）收盤 ${int.format(Math.abs(r.vsSpot))} 點`
  return `${FUTURES_NAME}夜盤（${r.span}）收 ${int.format(r.bar.close)}，較日盤結算 ${signed(r.bar.change)}（${pct}）${spot}。`
}

// --- Reliability and loading -----------------------------------------------

export interface FuturesReliability {
  status: 'verified' | 'mismatch' | 'stale' | 'unverified'
  label: string
  detail: string
}

const weekdaysAfter = (from: string, to: string) => {
  let n = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++
  return n
}

export function futuresReliability(bars: FuturesBar[], check: FuturesCheck | null | undefined, expected: Record<FuturesSession, string>): FuturesReliability {
  const night = bars.filter((b) => b.session === 'night').at(-1)
  if (!night) return { status: 'stale', label: '沒有資料', detail: '沒有讀到台指期資料' }
  // One weekday is allowed for a holiday the calendar does not know.
  if (weekdaysAfter(night.date, expected.night) > 1) {
    return { status: 'stale', label: '資料延遲', detail: `最新夜盤 ${night.date}，預期 ${expected.night}` }
  }
  if (!check) return { status: 'unverified', label: '未驗證', detail: '只有 FinMind 一個來源' }
  const latest = bars[bars.length - 1]
  if (check.date !== latest.date || check.session !== latest.session) {
    return { status: 'unverified', label: '未驗證', detail: `最新一盤（${latest.date} ${latest.session === 'night' ? '夜盤' : '日盤'}）尚未和期交所比對` }
  }
  const which = `${check.date} ${check.session === 'night' ? '夜盤' : '日盤'}`
  if (check.primary === null) return { status: 'verified', label: '已驗證', detail: `${which}取自${check.source}` }
  const gap = Math.abs(check.primary / check.official - 1)
  if (gap <= CHECK_TOLERANCE) return { status: 'verified', label: '已驗證', detail: `${which}與${check.source}相差 ${(gap * 100).toFixed(2)}%` }
  return { status: 'mismatch', label: '差異過大', detail: `${which} FinMind ${check.primary}、${check.source} ${check.official}，已改用${check.source}` }
}

const CACHE_KEY = 'pfm:indices:futures:'

// Tops the snapshot up from FinMind once a newer session should exist.
export async function catchUpFutures(
  known: FuturesBar[],
  expected: Record<FuturesSession, string>,
  fullStart: string,
  fetcher?: Fetcher,
): Promise<FuturesBar[]> {
  const has = (list: FuturesBar[]) => (s: FuturesSession) => list.some((b) => b.session === s && b.date >= expected[s])
  if (has(known)('night') && has(known)('day')) return known
  const key = `${CACHE_KEY}${expected.night}:${expected.day}`
  const cached = readCache<FuturesBar>(key)
  if (cached) return mergeBars(known, cached)
  const last = known.at(-1)?.date
  const fresh = await fetchFuturesBars(last ? addDays(last, -7) : fullStart, fetcher)
  if (has(fresh)('night') && has(fresh)('day')) writeCache(key, fresh)
  return mergeBars(known, fresh)
}

export const futuresStart = (today: string) => addDays(today, -FUTURES_HISTORY_DAYS)
