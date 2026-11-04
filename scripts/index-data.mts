// Builds public/data/indices.json for the market page's daily index panel.
// Runs in GitHub Actions before each build (after the Taiwan and the US
// close). FinMind provides the history; each latest close is checked
// against an official source that blocks browsers, and TWSE breadth is
// added. No source needs a key.
//
//   npx tsx scripts/index-data.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  FLOW_DAYS,
  INDEX_DEFS,
  applyCheck,
  fetchFlows,
  fetchIndexPoints,
  fetchMargin,
  historyStart,
  type Breadth,
  type IndexCheck,
  type IndexKey,
  type IndexPoint,
  type IndicesData,
} from '../src/lib/market/indices.ts'

const OUT = 'public/data/indices.json'
const UA = 'Mozilla/5.0 (personal-wealth-management data job)'
// TWSE blocks clients that send more than ~3 requests per 5 seconds.
const GAP_MS = 2000

const today = new Date().toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const num = (text: string) => Number(text.replace(/,/g, '').replace(/\(.*\)/, '').trim())
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response
}

// --- Official closes -------------------------------------------------------

// 證交所 monthly market summary: the 加權指數 close of each trading day.
async function twseTaiex(): Promise<IndexPoint> {
  for (const back of [0, 20]) {
    const ymd = daysAgo(back).replace(/-/g, '')
    const json = (await (await get(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${ymd}&response=json`)).json()) as {
      stat: string
      data?: string[][]
    }
    const row = json.data?.[json.data.length - 1]
    if (json.stat === 'OK' && row) {
      const [y, m, d] = row[0].split('/')
      return { date: `${Number(y) + 1911}-${m}-${d}`, close: num(row[4]) }
    }
    await sleep(GAP_MS)
  }
  throw new Error('證交所沒有本月與上月的加權指數')
}

// 櫃買中心 monthly index table.
async function tpexIndex(): Promise<IndexPoint> {
  for (const back of [0, 20]) {
    const date = daysAgo(back).replace(/-/g, '/')
    const json = (await (await get(`https://www.tpex.org.tw/www/zh-tw/indexInfo/inx?date=${date}&response=json`)).json()) as {
      tables?: { data?: string[][] }[]
    }
    const rows = json.tables?.[0]?.data ?? []
    const row = rows[rows.length - 1]
    if (row) return { date: row[0].replace(/\//g, '-'), close: num(row[4]) }
  }
  throw new Error('櫃買中心沒有本月與上月的櫃買指數')
}

async function fredLatest(id: string): Promise<IndexPoint> {
  const csv = await (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${daysAgo(20)}`)).text()
  const points = csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','))
    .map(([date, value]) => ({ date, close: Number(value) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.close) && p.close > 0)
  if (points.length === 0) throw new Error(`FRED ${id} 沒有資料`)
  return points[points.length - 1]
}

// Yahoo Finance's public chart endpoint (no key), dated in exchange time.
async function yahooLatest(symbol: string): Promise<IndexPoint> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
  const json = (await (await get(url)).json()) as {
    chart: { result: { meta: { gmtoffset: number }; timestamp: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] }
  }
  const r = json.chart.result[0]
  const points = r.timestamp
    .map((t, i) => ({ date: new Date((t + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10), close: r.indicators.quote[0].close[i] }))
    .filter((p): p is IndexPoint => p.close !== null && p.close > 0)
  if (points.length === 0) throw new Error(`Yahoo ${symbol} 沒有資料`)
  return points[points.length - 1]
}

const OFFICIAL: Partial<Record<IndexKey, () => Promise<IndexPoint>>> = {
  TAIEX: twseTaiex,
  TPEx: tpexIndex,
  GSPC: () => fredLatest('SP500'),
  IXIC: () => fredLatest('NASDAQCOM'),
  DJI: () => fredLatest('DJIA'),
  VIX: () => fredLatest('VIXCLS'),
  SOX: () => yahooLatest('^SOX'),
}

// --- TWSE breadth ----------------------------------------------------------

async function twseBreadth(): Promise<Breadth> {
  for (let back = 0; back < 10; back++) {
    const date = daysAgo(back)
    const json = (await (await get(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date.replace(/-/g, '')}&type=MS&response=json`)).json()) as {
      stat: string
      tables?: { title?: string; data?: string[][] }[]
    }
    const rows = json.tables?.find((t) => t.title?.includes('漲跌證券數'))?.data
    // Column 2 counts common stocks only (column 1 includes warrants).
    const count = (prefix: string) => num(rows?.find((r) => r[0].startsWith(prefix))?.[2] ?? 'NaN')
    if (json.stat === 'OK' && rows) {
      return { date, up: count('上漲'), down: count('下跌'), unchanged: count('持平') }
    }
    await sleep(GAP_MS)
  }
  throw new Error('近 10 天沒有漲跌家數')
}

// --- Assemble -------------------------------------------------------------

async function attempt<T>(label: string, errors: string[], task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (e) {
    errors.push(`${label}：${(e as Error).message}`)
    console.warn(`[index-data] ${label} 失敗：${(e as Error).message}`)
    return null
  }
}

async function main() {
  const errors: string[] = []
  const series: IndicesData['series'] = {}
  const checks: IndicesData['checks'] = {}
  for (const def of INDEX_DEFS) {
    const points = (await attempt(`FinMind ${def.name}`, errors, () => fetchIndexPoints(def, historyStart(today)))) ?? []
    const official = OFFICIAL[def.key]
    const ref = official ? await attempt(`${def.check} ${def.name}`, errors, official) : null
    if (ref) {
      const check: IndexCheck = {
        source: def.check!,
        date: ref.date,
        official: Math.round(ref.close * 100) / 100,
        primary: points.find((p) => p.date === ref.date)?.close ?? null,
      }
      checks[def.key] = check
      series[def.key] = applyCheck(points, check)
      if (check.primary !== null && Math.abs(check.primary / check.official - 1) > 0.005) {
        console.warn(`[index-data] ${def.name} ${check.date} FinMind ${check.primary} 與 ${check.source} ${check.official} 不一致`)
      }
    } else {
      series[def.key] = points
    }
    if (def.market === 'TW') await sleep(GAP_MS)
  }
  const breadth = await attempt('證交所漲跌家數', errors, twseBreadth)
  const flowStart = daysAgo(Math.round(FLOW_DAYS * 1.5))
  const flows = (await attempt('FinMind 三大法人', errors, () => fetchFlows(flowStart))) ?? []
  const margin = (await attempt('FinMind 融資餘額', errors, () => fetchMargin(flowStart))) ?? []

  // Nothing fetched: keep the previous file rather than overwrite it.
  if (!series.TAIEX?.length && !series.GSPC?.length) throw new Error(`沒有讀到任何指數：${errors.join('；')}`)
  const data: IndicesData = { generatedAt: new Date().toISOString(), errors, series, checks, breadth, flows, margin }
  mkdirSync('public/data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(data))
  const summary = INDEX_DEFS.map((d) => {
    const c = checks[d.key]
    const gap = c && c.primary !== null ? ` 差 ${((c.primary / c.official - 1) * 100).toFixed(3)}%` : ''
    return `${d.key} ${series[d.key]?.length ?? 0} 筆${series[d.key]?.at(-1)?.date ?? ''}${gap}`
  })
  console.log(`[index-data] ${OUT}：${summary.join('；')}；${errors.length} 個錯誤`)
}

await main()
