// Builds public/data/daily-research.json at 06:00 Taiwan time (handbook 06
// §1.1): one stock from each of seven screens gets the automatic health
// check, and those rated 留意 or better a comparison of every library
// template over 5 years. Free data only (FinMind, 證交所). The site imports
// the results into the research cards and comparisons when it opens.
//
//   npx tsx scripts/daily-research.mts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { StockData } from '../src/lib/screener/stockData.ts'
import { buildAutoResearch } from '../src/lib/research/autoResearch.ts'
import { rateAuto, OVERALL_LABELS } from '../src/lib/research/rating.ts'
import { mergeRuns, pickDaily, qualifies, runSummary, type DailyItem, type DailyResearchFile } from '../src/lib/research/dailyResearch.ts'
import { createDefaultInvestmentPolicy } from '../src/lib/storage/schema.ts'
import { builtInLibrary, compareEntriesOf } from '../src/lib/backtest/library.ts'
import { STRATEGY_TEMPLATES } from '../src/lib/backtest/templates.ts'
import { loadChipData, loadPriceData } from '../src/lib/backtest/data.ts'
import { runComparison, summarizeComparison, toSavedRows } from '../src/lib/backtest/compare.ts'
import { marketCosts } from '../src/lib/backtest/engine.ts'
import { isoDaysAgo } from '../src/lib/market/priceHistory.ts'

const OUT = 'public/data/daily-research.json'
const YEARS = 5
const CAPITAL = 1_000_000
const OOS = 0.3
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const log = (msg: string) => console.log(`[daily-research] ${msg}`)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120)

const stocks = (JSON.parse(readFileSync('public/data/stocks.json', 'utf8')) as StockData).stocks
const prev: DailyResearchFile | null = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as DailyResearchFile) : null
const policy = createDefaultInvestmentPolicy()
const { picks, skipped } = pickDaily(stocks, prev?.log ?? [], today)
log(`${today}：${picks.map((p) => `${p.screenName} ${p.code}`).join('、')}`)

async function compare(code: string, name: string) {
  const symbol = `TW:${code}`
  const start = isoDaysAgo(today, YEARS)
  const entries = compareEntriesOf(builtInLibrary(), 1)
  const data = await loadPriceData([symbol], start, today)
  let chips
  if (entries.some((e) => STRATEGY_TEMPLATES[e.template].chipData)) {
    try {
      chips = await loadChipData([symbol], start)
    } catch {
      // The chip template's row says it did not run; the rest still do.
    }
  }
  const result = runComparison({
    entries,
    base: { data, chips, start, end: today, initialCapital: CAPITAL, costs: marketCosts(policy.brokerFeeDiscount, 0), sizing: { mode: 'equal', riskPercent: policy.riskPerTradePercent } },
    oosFraction: OOS,
    maxDrawdownLimitPercent: policy.maxDrawdownTolerancePercent,
  })
  if (result.equity.length < 2) throw new Error('這段期間沒有足夠的價格資料')
  const { rows } = toSavedRows(result)
  // Saved without the curve: too large to keep every day.
  return { symbol, name, start, end: today, initialCapital: CAPITAL, outOfSampleStart: result.oosStart, round: 0, trials: result.trials, summary: summarizeComparison(result.rows), rows, equity: [] }
}

const items: DailyItem[] = []
for (const pick of picks) {
  const item: DailyItem = { ...pick }
  try {
    item.auto = await buildAutoResearch(pick.code, today)
    item.rating = rateAuto(item.auto, policy)?.overall
  } catch (e) {
    item.error = `體檢失敗：${message(e)}`
  }
  if (item.auto && qualifies(item.rating)) {
    try {
      item.comparison = await compare(pick.code, pick.name)
    } catch (e) {
      item.error = `回測失敗：${message(e)}`
    }
  }
  log(`${pick.screenName} ${pick.code} ${pick.name}：${item.rating ? OVERALL_LABELS[item.rating] : '—'}${item.comparison ? `，回測 ${item.comparison.summary.headline}` : ''}${item.error ? `（${item.error}）` : ''}`)
  items.push(item)
}

const run = { date: today, items, skipped }
writeFileSync(OUT, JSON.stringify(mergeRuns(prev, run, new Date().toISOString())))
log(`${OUT}：${runSummary(run)}${skipped.length > 0 ? `；略過 ${skipped.map((s) => `${s.screenName}（${s.reason}）`).join('、')}` : ''}`)
