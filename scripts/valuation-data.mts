// Appends today's TWSE-wide P/E to public/data/valuation.json, from the
// public/data/stocks.json written just before. The deploy job restores the
// published file first, so the history grows one point per trading day.
//
//   npx tsx scripts/valuation-data.mts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { aggregatePe, type ValuationPoint } from '../src/lib/market/valuation.ts'

const STOCKS = 'public/data/stocks.json'
const OUT = 'public/data/valuation.json'

const stocks = JSON.parse(readFileSync(STOCKS, 'utf8')) as { date: string; stocks: { isEtf?: boolean; pe: number | null; marketCap: number | null }[] }
const pe = aggregatePe(stocks.stocks)
if (pe === null) throw new Error('沒有可用的本益比')
const old: ValuationPoint[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as { points: ValuationPoint[] }).points : []
const points = [...old.filter((p) => p.date !== stocks.date), { date: stocks.date, pe }].sort((a, b) => a.date.localeCompare(b.date))
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), points }))
console.log(`[valuation-data] ${stocks.date} 台股本益比 ${pe} 倍，共 ${points.length} 筆`)
