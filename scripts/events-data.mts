// Builds public/data/events.json: ex-dividend dates (TWSE TWT48U_ALL, TPEx
// 除權除息預告表) and investor conferences parsed from the daily material
// information of listed and OTC companies. Open government data, no key.
// Conference notices only show on the day they are filed, so the published
// file (restored by the deploy job) is merged with today's.
//
//   npx tsx scripts/events-data.mts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { addDays, conferenceDate, EVENT_RULES, rocDate, type MarketEvent } from '../src/lib/market/events.ts'

const OUT = 'public/data/events.json'
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url}：${res.status}`)
  return (await res.json()) as T
}

const errors: string[] = []
async function attempt<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (e) {
    errors.push(`${label}：${(e as Error).message}`)
    console.warn(`[events-data] ${label} 失敗：${(e as Error).message}`)
    return null
  }
}

const money = (v: string | undefined) => (v && Number(v) > 0 ? `${Number(v)} 元` : '')

const exdiv: MarketEvent[] = []
const twse = await attempt('證交所除權除息預告', () => json<Record<string, string>[]>('https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL'))
for (const r of twse ?? []) {
  const date = rocDate(r.Date ?? '')
  if (date) exdiv.push({ date, kind: 'exdiv', ticker: r.Code, name: r.Name, title: `除${r.Exdividend ?? '權息'}${money(r.CashDividend) && ` ${money(r.CashDividend)}`}`, source: '證交所' })
}
const tpex = await attempt('櫃買中心除權除息預告', () => json<Record<string, string>[]>('https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'))
for (const r of tpex ?? []) {
  const date = rocDate(r.ExRrightsExDividendDate ?? '')
  if (date) exdiv.push({ date, kind: 'exdiv', ticker: r.SecuritiesCompanyCode, name: r.CompanyName, title: `${r.ExRrightsExDividend ?? '除權息'}${money(r.CashDividend) && ` ${money(r.CashDividend)}`}`, source: '櫃買中心' })
}

const conferences: MarketEvent[] = []
for (const [label, url, source] of [
  ['證交所重大訊息', 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L', '證交所'],
  ['櫃買中心重大訊息', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O', '櫃買中心'],
] as const) {
  const rows = await attempt(label, () => json<Record<string, string>[]>(url))
  for (const r of rows ?? []) {
    // Field names differ slightly between feeds (a trailing space on 主旨).
    const subject = r['主旨 '] ?? r['主旨'] ?? ''
    const date = conferenceDate(subject, r['說明'] ?? '')
    if (date) conferences.push({ date, kind: 'conference', ticker: r['公司代號'] ?? r.SecuritiesCompanyCode, name: r['公司名稱'] ?? r.CompanyName, title: '法人說明會', source })
  }
}

const previous: MarketEvent[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as { events: MarketEvent[] }).events : []
const from = addDays(today, -EVENT_RULES.keepPastDays)
const to = addDays(today, EVENT_RULES.keepAheadDays)
const key = (e: MarketEvent) => `${e.kind}|${e.ticker}|${e.date}`
const merged = new Map<string, MarketEvent>()
// Conferences accumulate; ex-dividend lists are replaced when they loaded.
for (const e of previous) if (e.kind === 'conference' || !twse) merged.set(key(e), e)
for (const e of [...exdiv, ...conferences]) merged.set(key(e), e)
const events = [...merged.values()].filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date))

mkdirSync('public/data', { recursive: true })
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), errors, events }))
console.log(`[events-data] ${OUT}：除權息 ${exdiv.length} 筆、今日法說會公告 ${conferences.length} 筆，共 ${events.length} 筆，錯誤 ${errors.length}`)
