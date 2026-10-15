// Builds public/data/stocks.json for the screener. Runs in GitHub Actions
// after the macro data: the TWSE open API needs no key but blocks browsers
// (no CORS), so the site reads this same-origin snapshot.
//
//   npx tsx scripts/stocks-data.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import { isEtfCode, priceReturn, type StockData, type StockRow } from '../src/lib/screener/stockData.ts'

const OUT = 'public/data/stocks.json'
const OPENAPI = 'https://openapi.twse.com.tw/v1'
const UA = 'Mozilla/5.0 (personal-wealth-management data job)'
// TWSE blocks clients that send more than ~3 requests per 5 seconds.
const GAP_MS = 2000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return (await response.json()) as T
}

function num(text: string | undefined): number | null {
  if (text === undefined) return null
  const v = Number(String(text).replace(/,/g, '').trim())
  return text.trim() !== '' && Number.isFinite(v) ? v : null
}

// "1151014" (ROC) → "2026-10-14"
function rocDate(roc: string): string {
  return `${Number(roc.slice(0, 3)) + 1911}-${roc.slice(3, 5)}-${roc.slice(5, 7)}`
}

function round(v: number | null, digits: number): number | null {
  return v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits
}

// All closes on the trading day on or before `date` (walks back over holidays).
async function closesOn(date: string): Promise<Map<string, number>> {
  for (let back = 0; back < 8; back++) {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - back)
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
    await sleep(GAP_MS)
    const json = await getJson<{ stat: string; tables?: { fields?: string[]; data?: string[][] }[] }>(
      `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`,
    )
    const table = json.tables?.find((t) => t.fields?.includes('證券代號') && t.fields.includes('收盤價'))
    if (json.stat !== 'OK' || !table?.data?.length) continue
    const iCode = table.fields!.indexOf('證券代號')
    const iClose = table.fields!.indexOf('收盤價')
    return new Map(
      table.data
        .map((r) => [r[iCode].trim(), num(r[iClose])] as const)
        .filter((e): e is [string, number] => e[1] !== null && e[1] > 0),
    )
  }
  throw new Error(`找不到 ${date} 前後的收盤資料`)
}

function monthsAgo(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const errors: string[] = []
  type Daily = { Date: string; Code: string; Name: string; TradeValue: string; ClosingPrice: string }
  const daily = await getJson<Daily[]>(`${OPENAPI}/exchangeReport/STOCK_DAY_ALL`)
  const date = rocDate(daily[0].Date)

  const attempt = async <T,>(label: string, task: () => Promise<T>): Promise<T | null> => {
    try {
      return await task()
    } catch (e) {
      errors.push(`${label}：${(e as Error).message}`)
      return null
    }
  }

  type Valuation = { Code: string; PEratio: string; DividendYield: string; PBratio: string }
  const valuation = new Map(
    ((await attempt('本益比／殖利率', () => getJson<Valuation[]>(`${OPENAPI}/exchangeReport/BWIBBU_ALL`))) ?? []).map((v) => [v.Code, v]),
  )
  type Revenue = Record<string, string>
  const revenue = new Map(
    ((await attempt('月營收', () => getJson<Revenue[]>(`${OPENAPI}/opendata/t187ap05_L`))) ?? []).map((r) => [r['公司代號'], r]),
  )
  const shares = new Map(
    ((await attempt('公司基本資料', () => getJson<Revenue[]>(`${OPENAPI}/opendata/t187ap03_L`))) ?? []).map((r) => [
      r['公司代號'],
      num(r['已發行普通股數或TDR原股發行股數']),
    ]),
  )

  const past: Record<'1m' | '3m' | '6m' | '12m', Map<string, number>> = { '1m': new Map(), '3m': new Map(), '6m': new Map(), '12m': new Map() }
  for (const [key, months] of [['1m', 1], ['3m', 3], ['6m', 6], ['12m', 12]] as const) {
    past[key] = (await attempt(`${months} 個月前收盤`, () => closesOn(monthsAgo(date, months)))) ?? new Map()
  }

  const stocks: StockRow[] = daily
    .map((d) => {
      const code = d.Code.trim()
      const close = num(d.ClosingPrice)
      const v = valuation.get(code)
      const r = revenue.get(code)
      const etf = isEtfCode(code)
      const issued = shares.get(code) ?? null
      const ym = r?.['資料年月']
      return {
        code,
        name: d.Name.trim(),
        industry: etf ? 'ETF' : (r?.['產業別'] ?? '其他'),
        isEtf: etf,
        close,
        pe: num(v?.PEratio) || null,
        dividendYield: num(v?.DividendYield),
        pb: num(v?.PBratio) || null,
        marketCap: close !== null && issued ? round((close * issued) / 1e8, 0) : null,
        tradeValue: round((num(d.TradeValue) ?? 0) / 1e8, 2),
        revenueYoy: round(num(r?.['營業收入-去年同月增減(%)']), 1),
        revenueYtdYoy: round(num(r?.['累計營業收入-前期比較增減(%)']), 1),
        revenueMonth: ym ? `${Number(ym.slice(0, 3)) + 1911}-${ym.slice(3, 5)}` : null,
        ret1m: round(priceReturn(close, past['1m'].get(code)), 4),
        ret3m: round(priceReturn(close, past['3m'].get(code)), 4),
        ret6m: round(priceReturn(close, past['6m'].get(code)), 4),
        ret12m: round(priceReturn(close, past['12m'].get(code)), 4),
      }
    })
    .filter((s) => s.close !== null)

  const data: StockData = { generatedAt: new Date().toISOString(), date, errors, stocks }
  mkdirSync('public/data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(data))
  console.log(`[stocks-data] ${OUT}：${stocks.length} 檔（${date}）、${errors.length} 個錯誤`)
}

await main()
