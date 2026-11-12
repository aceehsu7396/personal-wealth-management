// Builds src/lib/calculations/stressScenarios.json: the historical stress scenarios of the
// risk page (blueprint 02 §5.2). For each crisis it finds the TAIEX peak
// and trough inside a search window, then measures the other markets over
// the same dates:
//   - TAIEX: TWSE monthly history (MI_5MINS_HIST)
//   - S&P 500: FinMind USStockPrice ^GSPC, or Yahoo Finance when FinMind's
//     free quota is used up
//   - USD/TWD: FRED DEXTAUS
//   - Long bonds: FRED DGS20 yield change × duration 17 (price ≈ −D × Δy)
// History does not change, so this runs once by hand and the JSON is
// committed and bundled with the site:
//
//   npx tsx scripts/stress-data.mts
import { writeFileSync } from 'node:fs'
import { requestDataset } from '../src/lib/research/finmind.ts'

const OUT = 'src/lib/calculations/stressScenarios.json'
const DURATION = 17
const TWSE_GAP_MS = 3500

const WINDOWS = [
  { id: 'h2000', label: '2000 網路泡沫', from: '2000-01-01', to: '2001-12-31' },
  { id: 'h2008', label: '2008 金融海嘯', from: '2007-07-01', to: '2009-03-31' },
  { id: 'h2015', label: '2015 中國股災', from: '2015-04-01', to: '2016-02-29' },
  { id: 'h2020', label: '2020 新冠疫情', from: '2020-01-01', to: '2020-04-30' },
  { id: 'h2022', label: '2022 升息', from: '2022-01-01', to: '2022-12-31' },
]

type Point = { date: string; close: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Network hiccups on a long run should not lose the whole download.
async function get(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init)
    } catch (e) {
      if (attempt >= 4) throw e
      await sleep(5000 * attempt)
    }
  }
}

function months(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}${String(m).padStart(2, '0')}01`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

async function taiex(from: string, to: string): Promise<Point[]> {
  const out: Point[] = []
  for (const [i, date] of months(from, to).entries()) {
    if (i > 0) await sleep(TWSE_GAP_MS)
    const res = await get(`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${date}`)
    const json = (await res.json()) as { stat: string; data?: string[][] }
    if (json.stat !== 'OK' || !json.data) throw new Error(`TWSE ${date}: ${json.stat}`)
    for (const row of json.data) {
      const [roc, , , , close] = row
      const [ry, rm, rd] = roc.trim().split('/')
      out.push({ date: `${Number(ry) + 1911}-${rm}-${rd}`, close: Number(close.replace(/,/g, '')) })
    }
  }
  return out
}

async function fred(id: string, from: string, to: string): Promise<Point[]> {
  const text = await (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}&coed=${to}`)).text()
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','))
    .filter(([, v]) => v && v !== '.')
    .map(([date, v]) => ({ date, close: Number(v) }))
}

async function yahoo(from: string, to: string): Promise<Point[] | null> {
  const t = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000)
  const res = await get(`https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${t(from)}&period2=${t(to) + 86400}&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  const json = (await res.json()) as { chart: { result?: { timestamp: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] } }
  const r = json.chart.result?.[0]
  if (!r) return null
  return r.timestamp.map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: r.indicators.quote[0].close[i] ?? 0 })).filter((p) => p.close > 0)
}

async function spx(from: string, to: string): Promise<{ points: Point[]; source: string } | null> {
  try {
    const rows = await requestDataset<{ date: string; Close: number }>('USStockPrice', '^GSPC', from)
    const out = rows.map((r) => ({ date: r.date.slice(0, 10), close: r.Close })).filter((p) => p.date <= to && p.close > 0)
    if (out.length > 0 && out[0].date <= from.replace(/-\d\d$/, '-28')) return { points: out, source: 'FinMind' }
  } catch (e) {
    console.warn('FinMind S&P 500 讀取失敗，改用 Yahoo Finance：', (e as Error).message)
  }
  const y = await yahoo(from, to)
  return y && y.length > 0 ? { points: y, source: 'Yahoo Finance' } : null
}

// The value on or just before a date.
const at = (series: Point[], date: string) => [...series].reverse().find((p) => p.date <= date)?.close ?? null
const pct = (a: number | null, b: number | null) => (a !== null && b !== null && a > 0 ? Math.round((b / a - 1) * 1000) / 10 : null)

const scenarios = []
for (const w of WINDOWS) {
  const tw = await taiex(w.from, w.to)
  let peak = tw[0]
  let best = { peak: tw[0], trough: tw[0], fall: 0 }
  for (const p of tw) {
    if (p.close > peak.close) peak = p
    const fall = p.close / peak.close - 1
    if (fall < best.fall) best = { peak, trough: p, fall }
  }
  const start = best.peak.date
  const end = best.trough.date
  const us = await spx(w.from, w.to)
  const fx = await fred('DEXTAUS', w.from, w.to)
  const dgs20 = await fred('DGS20', w.from, w.to)
  const dy = (at(dgs20, end) ?? 0) - (at(dgs20, start) ?? 0)
  scenarios.push({
    id: w.id,
    label: w.label,
    period: `${start} – ${end}`,
    kind: 'historical',
    tw: Math.round(best.fall * 1000) / 10,
    us: us ? pct(at(us.points, start), at(us.points, end)) : null,
    fx: pct(at(fx, start), at(fx, end)),
    bond: dgs20.length > 0 ? Math.round(-DURATION * dy * 10) / 10 : null,
    source: `加權指數：證交所；S&P 500：${us?.source ?? '無資料'}；美元兌新台幣：FRED DEXTAUS；長債：FRED DGS20 殖利率變化 × 存續期間 17 估算`,
  })
  console.log(w.label, scenarios.at(-1))
}

writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), scenarios }, null, 2)}\n`)
console.log(`寫入 ${OUT}`)
