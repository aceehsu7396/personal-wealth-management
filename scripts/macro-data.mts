// Builds public/data/macro.json for the market page. Runs in GitHub Actions
// before each build (daily schedule): these sources need no API key but
// block browsers (no CORS), so the site reads this same-origin snapshot.
//
//   npx tsx scripts/macro-data.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfPages } from './pdfText.mts'
import { dateFromFileName, parseFubonReport, parseResearchList } from '../src/lib/macro/fubonParse.ts'
import { FRED_SERIES, type FubonReportData, type MacroData, type Point, type SeriesKey } from '../src/lib/macro/macroData.ts'

const OUT = 'public/data/macro.json'
const FUBON = 'https://invest.fubonlife.com.tw'
const FUBON_REPORTS = 12
const UA = 'Mozilla/5.0 (personal-wealth-management data job)'

const today = new Date().toISOString().slice(0, 10)
const yearsAgo = (n: number) => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response
}

// --- FRED (CSV, no key) ---------------------------------------------------

async function fred(id: string): Promise<Point[]> {
  const csv = await (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${yearsAgo(3)}`)).text()
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','))
    .map(([date, value]) => ({ date, value: Number(value) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value) && p.value !== 0)
}

// --- 國發會 business indicators (zip of CSVs) --------------------------------

const NDC_ZIP =
  'https://ws.ndc.gov.tw/Download.ashx?u=LzAwMS9hZG1pbmlzdHJhdG9yLzEwL3JlbGZpbGUvNTc4MS82MzkyL2VhMjM1YmQ5LWQwNTItNGE2OS1hYmZjLWQ1Yzc4NWQzZDBlMi56aXA%3d&n=5pmv5rCj5oyH5qiZ5Y%2bK54eI6JmfLnppcA%3d%3d&icon=.zip'

function csvColumn(text: string, column: string, from: string): Point[] {
  const [header, ...rows] = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  const names = header.split(',').map((h) => h.replace(/"/g, '').trim())
  const i = names.indexOf(column)
  if (i < 0) throw new Error(`國發會資料缺少欄位 ${column}`)
  return rows
    .map((r) => r.split(','))
    .map((cells) => ({ ym: cells[0].replace(/"/g, ''), value: Number(cells[i]) }))
    .filter((r) => /^\d{6}$/.test(r.ym) && r.value > 0)
    .map((r) => ({ date: `${r.ym.slice(0, 4)}-${r.ym.slice(4)}-01`, value: r.value }))
    .filter((p) => p.date >= from)
}

async function ndc(): Promise<{ score: Point[]; exports: Point[] }> {
  const dir = join(tmpdir(), `ndc-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const zip = join(dir, 'ndc.zip')
  writeFileSync(zip, new Uint8Array(await (await get(NDC_ZIP)).arrayBuffer()))
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir])
  const from = yearsAgo(3)
  return {
    score: csvColumn(readFileSync(join(dir, '景氣指標與燈號.csv'), 'utf8'), '景氣對策信號綜合分數', from),
    exports: csvColumn(readFileSync(join(dir, '同時指標構成項目.csv'), 'utf8'), '海關出口值(十億元)', from),
  }
}

// --- 主計總處 CPI (SDMX JSON) ----------------------------------------------

async function twCpi(): Promise<Point[]> {
  const start = `${Number(today.slice(0, 4)) - 3}-M1`
  const end = `${today.slice(0, 4)}-M12`
  const url = `https://nstatdb.dgbas.gov.tw/dgbasall/webMain.aspx?sdmx/A030101015/1..1.M.&startTime=${start}&endTime=${end}`
  const json = (await (await get(url)).json()) as {
    data: {
      dataSets: { series: Record<string, { observations: Record<string, number[]> }> }[]
      structure: { dimensions: { observation: { values: { id: string }[] }[] } }
    }
  }
  const periods = json.data.structure.dimensions.observation[0].values
  const obs = json.data.dataSets[0].series['0'].observations
  return Object.entries(obs)
    .map(([k, v]) => {
      const [y, m] = periods[Number(k)].id.split('-M')
      return { date: `${y}-${m.padStart(2, '0')}-01`, value: v[0] }
    })
    .filter((p) => p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// --- TWSE margin balance --------------------------------------------------

async function marginOn(date: string): Promise<Point | null> {
  // Walk back over holidays until a trading day reports.
  for (let back = 0; back < 10; back++) {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - back)
    const ymd = d.toISOString().slice(0, 10)
    const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${ymd.replace(/-/g, '')}&selectType=MS&response=json`
    const json = (await (await get(url)).json()) as { stat: string; tables?: { data?: string[][] }[] }
    const row = json.tables?.[0]?.data?.find((r) => r[0].startsWith('融資金額'))
    if (json.stat === 'OK' && row) return { date: ymd, value: Number(row[5].replace(/,/g, '')) }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

// --- Fubon monthly outlooks -----------------------------------------------

async function fubon(): Promise<FubonReportData[]> {
  const html = await (await get(`${FUBON}/financial-news/research`)).text()
  const listed = parseResearchList(html).slice(0, FUBON_REPORTS)
  // Keyed by the date printed in the PDF; a later upload of the same issue wins.
  const byDate = new Map<string, FubonReportData>()
  for (const f of [...listed].reverse()) {
    const pdfUrl = `${FUBON}${f.path.split('/').map((p) => encodeURIComponent(decodeURIComponent(p))).join('/')}`
    try {
      const pages = await pdfPages(new Uint8Array(await (await get(pdfUrl)).arrayBuffer()))
      const report = parseFubonReport(pages, dateFromFileName(f.path) ?? f.listedDate)
      // Issues before 2026/4 use an older layout the parser does not read.
      if (report.allocation.length > 0) byDate.set(report.reportDate, { ...report, pdfUrl })
    } catch (e) {
      console.warn(`富邦 ${f.path} 解析失敗：${(e as Error).message}`)
    }
  }
  return [...byDate.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
}

// --- Assemble -------------------------------------------------------------

async function attempt<T>(label: string, errors: string[], task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (e) {
    errors.push(`${label}：${(e as Error).message}`)
    console.warn(`[macro-data] ${label} 失敗：${(e as Error).message}`)
    return null
  }
}

async function main() {
  const errors: string[] = []
  const series: Partial<Record<SeriesKey, Point[]>> = {}
  for (const id of Object.keys(FRED_SERIES) as (keyof typeof FRED_SERIES)[]) {
    const points = await attempt(`FRED ${id}`, errors, () => fred(id))
    if (points) series[id] = points
  }
  const ndcData = await attempt('國發會景氣指標', errors, ndc)
  if (ndcData) {
    series.TW_BUSINESS_SCORE = ndcData.score
    series.TW_EXPORTS = ndcData.exports
  }
  const cpi = await attempt('主計總處 CPI', errors, twCpi)
  if (cpi) series.TW_CPI = cpi

  const before = new Date(`${today}T00:00:00Z`)
  before.setUTCMonth(before.getUTCMonth() - 3)
  const now = await attempt('證交所融資餘額', errors, () => marginOn(today))
  const earlier = await attempt('證交所融資餘額（3 個月前）', errors, () => marginOn(before.toISOString().slice(0, 10)))

  const reports = (await attempt('富邦市場展望', errors, fubon)) ?? []
  if (reports.length === 0 && !errors.some((e) => e.startsWith('富邦'))) errors.push('富邦市場展望：沒有解析到報告')

  const data: MacroData = {
    generatedAt: new Date().toISOString(),
    errors,
    series,
    margin: now && earlier ? { now, before: earlier } : null,
    fubon: reports,
  }
  mkdirSync('public/data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(data))
  console.log(
    `[macro-data] ${OUT}：${Object.keys(series).length} 個數列、${reports.length} 期富邦報告、${errors.length} 個錯誤`,
  )
}

await main()
