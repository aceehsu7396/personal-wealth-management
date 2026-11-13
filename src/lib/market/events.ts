import { useEffect, useState } from 'react'

// Event calendar (handbook 05 §9.1): ex-dividend dates and investor
// conferences from TWSE and TPEx open data (built daily into
// public/data/events.json), statutory report deadlines by rule, and central
// bank meetings from the banks' published schedules.

export type EventKind = 'exdiv' | 'conference' | 'revenue' | 'quarterly' | 'annual' | 'fomc' | 'cbc'

export interface MarketEvent {
  date: string
  kind: EventKind
  // Company events only.
  ticker?: string
  name?: string
  title: string
  source: string
}

export const EVENT_LABELS: Record<EventKind, string> = {
  exdiv: '除權息',
  conference: '法說會',
  revenue: '月營收',
  quarterly: '季報',
  annual: '年報',
  fomc: '美國聯準會',
  cbc: '台灣央行',
}

// Events that can gap a stock past its stop.
export const GAP_RISK: EventKind[] = ['conference', 'quarterly', 'annual']

export const EVENTS_DATA_PATH = 'data/events.json'
export const EVENT_RULES = { soonSessions: 3, planSessions: 5, calendarDays: 14, keepPastDays: 30, keepAheadDays: 60 } as const

// Decision days, from federalreserve.gov/monetarypolicy/fomccalendars.htm
// (updated 2026-10-28; each date tentative until the meeting before it).
export const FOMC_DATES = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
]

// 中央銀行理監事聯席會議, from cbc.gov.tw 新聞稿 (114)第213號 (2025-12-18).
// The 2027 schedule is published each December.
export const CBC_DATES = ['2026-03-19', '2026-06-18', '2026-09-17', '2026-12-17']

// 民國 dates: "1151113" or "115/11/23" → 2026-11-13.
export function rocDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2,3})\/?(\d{2})\/?(\d{2})$/) ?? s.trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  return `${Number(m[1]) + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

// The conference date from a 重大訊息 notice, or null if it is not one.
export function conferenceDate(subject: string, body: string): string | null {
  if (!subject.includes('法人說明會')) return null
  const m = body.match(/法人說明會之日期[：:]\s*(\d{2,3}\/\d{1,2}\/\d{1,2})/)
  return m ? rocDate(m[1]) : null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const weekendShift = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  return iso(d)
}

// Statutory deadlines (moved past weekends): monthly revenue by the 10th,
// Q1/Q2/Q3 reports by 5/15, 8/14, 11/14, the annual report by 3/31.
export function ruleEvents(from: string, to: string): MarketEvent[] {
  const out: MarketEvent[] = []
  const start = Number(from.slice(0, 4))
  const end = Number(to.slice(0, 4))
  for (let y = start; y <= end; y++) {
    for (let m = 1; m <= 12; m++) out.push({ date: weekendShift(`${y}-${String(m).padStart(2, '0')}-10`), kind: 'revenue', title: '上市櫃公司公布上月營收的截止日', source: '證券交易法規定' })
    out.push({ date: weekendShift(`${y}-03-31`), kind: 'annual', title: '年報截止日', source: '證券交易法第 36 條' })
    for (const [md, q] of [['05-15', 'Q1'], ['08-14', 'Q2'], ['11-14', 'Q3']]) out.push({ date: weekendShift(`${y}-${md}`), kind: 'quarterly', title: `${q} 季報截止日`, source: '證券交易法第 36 條' })
  }
  for (const d of FOMC_DATES) out.push({ date: d, kind: 'fomc', title: 'FOMC 利率決議', source: 'federalreserve.gov' })
  for (const d of CBC_DATES) out.push({ date: d, kind: 'cbc', title: '央行理監事會利率決議', source: '中央銀行' })
  return out.filter((e) => e.date >= from && e.date <= to)
}

// Weekdays from a to b (b after a), as a stand-in for trading sessions.
export function sessionsBetween(a: string, b: string): number {
  let n = 0
  const d = new Date(`${a}T00:00:00Z`)
  const end = Date.parse(`${b}T00:00:00Z`)
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++
  }
  return n
}

export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

// Events within `sessions` trading days, for given tickers (company events)
// plus market-wide ones when asked.
export function upcoming(events: MarketEvent[], today: string, sessions: number, tickers?: Set<string>, marketWide = true): MarketEvent[] {
  return events
    .filter((e) => e.date >= today && sessionsBetween(today, e.date) <= sessions)
    .filter((e) => (e.ticker ? !tickers || tickers.has(e.ticker) : marketWide))
    .sort((a, b) => a.date.localeCompare(b.date))
}

let shared: Promise<MarketEvent[]> | null = null

async function fetchEvents(base: string = import.meta.env.BASE_URL): Promise<MarketEvent[]> {
  try {
    const res = await fetch(`${base}${EVENTS_DATA_PATH}`, { cache: 'no-cache' })
    if (!res.ok) return []
    return ((await res.json()) as { events: MarketEvent[] }).events
  } catch {
    return []
  }
}

// Company events from the daily file plus the rule-based ones.
export function useEvents(today: string): MarketEvent[] {
  const [company, setCompany] = useState<MarketEvent[]>([])
  useEffect(() => {
    if (!shared) shared = fetchEvents()
    let alive = true
    void shared.then((e) => alive && setCompany(e))
    return () => {
      alive = false
    }
  }, [])
  return [...company, ...ruleEvents(addDays(today, -EVENT_RULES.keepPastDays), addDays(today, EVENT_RULES.keepAheadDays))]
}
