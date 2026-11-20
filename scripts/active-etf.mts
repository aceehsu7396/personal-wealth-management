// Builds public/data/active-etf.json (handbook 06 §1.2): the three largest
// Taiwan active ETFs and their daily holdings from the open-source project
// nctuwanglin/active-etf, each checked against its fund company's own site
// where a script can reach it (統一, 復華). History builds up on top of the
// published file, 60 days.
//
//   npx tsx scripts/active-etf.mts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  CHECKED_ISSUERS,
  KEEP_DAYS,
  THIRD_PARTY_HISTORY,
  THIRD_PARTY_HISTORY_LIST,
  THIRD_PARTY_URL,
  mergeHistory,
  parseFuhhwa,
  parsePresident,
  parseThirdParty,
  parseThirdPartyHistory,
  topByScale,
  unverified,
  verify,
  type ActiveEtfFile,
  type EtfSnapshot,
  type OfficialCheck,
  type OfficialHoldings,
} from '../src/lib/research/activeEtf.ts'

const OUT = 'public/data/active-etf.json'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const log = (msg: string) => console.log(`[active-etf] ${msg}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 100)

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  await sleep(1000)
  const response = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const roc = (date: string) => `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`
const unescapeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// 統一: the PCF page sets a cookie and maps stock codes to fund codes;
// GetPCF is looked up by announcement day, so step forward from the data
// day until the holdings' own date matches.
const PRESIDENT_PAGE = 'https://www.ezmoney.com.tw/ETF/Transaction/PCF'
let presidentSession: { cookie: string; funds: Map<string, string> } | null = null

async function presidentOfficial(code: string, dataDate: string): Promise<OfficialHoldings> {
  if (!presidentSession) {
    // The page sets a cookie and redirects to itself; fetch keeps no
    // cookies, so redirects are followed here with the cookie added.
    let cookie = ''
    let html = ''
    let url = PRESIDENT_PAGE
    for (let i = 0; i < 5 && !html.includes('DataFundList'); i++) {
      await sleep(1000)
      const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(30_000) })
      const set = r.headers.getSetCookie().map((c) => c.split(';')[0])
      if (set.length > 0) cookie = [...cookie.split('; ').filter((c) => !set.some((s) => s.split('=')[0] === c.split('=')[0])), ...set].filter(Boolean).join('; ')
      const location = r.headers.get('location')
      if (r.status >= 300 && r.status < 400 && location) url = new URL(location, url).toString()
      else html = await r.text()
    }
    const m = /DataFundList"[^>]*data-content="([^"]*)"/.exec(html)
    if (!m) throw new Error('統一官網的基金清單改版')
    const list = JSON.parse(unescapeHtml(m[1])) as { sStockNo: string; sFundCode: string }[]
    presidentSession = { cookie, funds: new Map(list.map((f) => [f.sStockNo.trim(), f.sFundCode])) }
  }
  const fundCode = presidentSession.funds.get(code)
  if (!fundCode) throw new Error(`統一官網找不到 ${code}`)
  let last: OfficialHoldings | null = null
  for (let k = 1; k <= 6; k++) {
    const r = await get('https://www.ezmoney.com.tw/ETF/Transaction/GetPCF', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: PRESIDENT_PAGE, Cookie: presidentSession.cookie },
      body: JSON.stringify({ fundCode, date: roc(addDays(dataDate, k)), specificDate: true }),
    })
    last = parsePresident(await r.json())
    if (last.dataDate === dataDate) return last
    if (last.dataDate && last.dataDate > dataDate) break
  }
  return last ?? { dataDate: null, scale: null, holdings: [] }
}

// 復華: fund list, then the holdings of a given day.
let fuhhwaFunds: Map<string, string> | null = null

async function fuhhwaOfficial(code: string, dataDate: string): Promise<OfficialHoldings> {
  if (!fuhhwaFunds) {
    const list = (await (await get('https://www.fhtrust.com.tw/api/fundList?ec001=3')).json()) as { result: { etf002?: string; fundID: string }[] }
    fuhhwaFunds = new Map(list.result.map((f) => [(f.etf002 ?? '').trim(), f.fundID]))
  }
  const fundID = fuhhwaFunds.get(code)
  if (!fundID) throw new Error(`復華官網找不到 ${code}`)
  const r = await get(`https://www.fhtrust.com.tw/api/assets?fundID=${fundID}&qDate=${dataDate.replace(/-/g, '/')}`)
  return parseFuhhwa(await r.json())
}

// Days a top fund is missing within the last 60, from the project's daily
// history files (a fund new to the top three, or the first run).
async function backfill(top: EtfSnapshot[], have: ActiveEtfFile['history'] | undefined): Promise<EtfSnapshot[]> {
  const latest = top.reduce((m, e) => (e.dataDate > m ? e.dataDate : m), '')
  const from = addDays(latest, -KEEP_DAYS + 1)
  let dates: string[]
  try {
    const list = (await (await get(THIRD_PARTY_HISTORY_LIST, { headers: { Accept: 'application/vnd.github+json' } })).json()) as { name: string }[]
    dates = list.map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name)?.[1]).filter((d): d is string => !!d && d >= from && d < latest)
  } catch (e) {
    errors.push(`歷史資料清單取得失敗：${message(e)}`)
    return []
  }
  const missing = dates.filter((d) => top.some((e) => !have?.[e.code]?.some((s) => s.dataDate === d)))
  const out: EtfSnapshot[] = []
  for (const d of missing) {
    try {
      out.push(...parseThirdPartyHistory(await (await get(`${THIRD_PARTY_HISTORY}${d}.json`)).json(), top.map((e) => e.code), top))
    } catch (e) {
      errors.push(`${d} 歷史資料取得失敗：${message(e)}`)
    }
  }
  if (missing.length > 0) log(`補入歷史 ${missing.length} 天（${missing[0]}～${missing.at(-1)}）`)
  return out
}

async function check(etf: EtfSnapshot): Promise<OfficialCheck> {
  const issuer = CHECKED_ISSUERS.find((i) => etf.issuer.includes(i))
  if (!issuer) return unverified(`${etf.issuer}官網不開放程式取得，無法比對`)
  try {
    const official = issuer === '統一' ? await presidentOfficial(etf.code, etf.dataDate) : await fuhhwaOfficial(etf.code, etf.dataDate)
    return verify(etf, official)
  } catch (e) {
    return unverified(`${issuer}官網取得失敗：${message(e)}`)
  }
}

const prev: ActiveEtfFile | null = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as ActiveEtfFile) : null
const errors: string[] = []
let parsed: ReturnType<typeof parseThirdParty> | null = null
try {
  parsed = parseThirdParty(await (await get(THIRD_PARTY_URL)).json())
} catch (e) {
  errors.push(`第三方資料未更新：${message(e)}`)
}

let out: ActiveEtfFile
if (!parsed || parsed.etfs.length === 0) {
  out = { ...(prev ?? { top: [], ranking: [], history: {}, sourceUpdated: null }), generatedAt: new Date().toISOString(), errors: [...errors, ...(parsed ? ['第三方資料沒有任何 ETF'] : [])] }
} else {
  const top = topByScale(parsed.etfs)
  const checked: EtfSnapshot[] = []
  for (const etf of top) {
    // A day already checked keeps its result unless it was not verified.
    const known = prev?.history[etf.code]?.find((s) => s.dataDate === etf.dataDate)
    const result = known?.check && known.check.status !== 'unverified' ? known.check : await check(etf)
    checked.push({ ...etf, check: result })
    log(`${etf.code} ${etf.name}（${etf.issuer}）${Math.round(etf.scale / 1e8)} 億、${etf.dataDate}、${etf.holdings.length} 檔：${result.note}`)
  }
  out = {
    generatedAt: new Date().toISOString(),
    sourceUpdated: parsed.updated,
    top: top.map((e) => e.code),
    ranking: [...parsed.etfs].filter((e) => /^00\d{3}A$/.test(e.code)).sort((a, b) => b.scale - a.scale).map(({ code, name, issuer, scale }) => ({ code, name, issuer, scale })),
    history: mergeHistory(prev?.history, [...(await backfill(top, prev?.history)), ...checked]),
    errors,
  }
}
writeFileSync(OUT, JSON.stringify(out))
log(`${OUT}：前三大 ${out.top.join('、')}${out.errors.length > 0 ? `；${out.errors.join('；')}` : ''}`)
