import { CACHE_PREFIX, fetchDataset, readCache, requestDataset, writeCache, type Fetcher } from './finmind'

// Chip (籌碼) data from FinMind: foreign and investment-trust net buying,
// margin balances and foreign ownership (handbook chapter 10 §1.2). Tested
// on 2016–2026 data it barely predicts returns but works as a "lose less"
// filter, so research cards show it as observed signals only.

// Net shares bought per day: [date, foreign, investment trust].
export type FlowRow = [string, number, number]

interface InstitutionalRow {
  date: string
  name: string
  buy: number
  sell: number
}

interface MarginRow {
  date: string
  MarginPurchaseTodayBalance: number
  ShortSaleTodayBalance: number
}

interface HoldingRow {
  date: string
  ForeignInvestmentSharesRatio: number
}

const FOREIGN = new Set(['Foreign_Investor', 'Foreign_Dealer_Self'])

export function condenseFlows(rows: InstitutionalRow[]): FlowRow[] {
  const byDate = new Map<string, FlowRow>()
  for (const r of rows) {
    const row = byDate.get(r.date) ?? [r.date, 0, 0]
    const net = (r.buy ?? 0) - (r.sell ?? 0)
    if (FOREIGN.has(r.name)) row[1] += net
    else if (r.name === 'Investment_Trust') row[2] += net
    byDate.set(r.date, row)
  }
  return [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]))
}

// Daily net buying since `start`. Ten years of raw rows are ~1 MB, so only
// the condensed rows are cached (a day, like other FinMind data).
export async function loadChipFlows(code: string, start: string, fetcher?: Fetcher): Promise<FlowRow[]> {
  const key = `${CACHE_PREFIX}flows:${code}:${start}`
  const cached = readCache<FlowRow>(key)
  if (cached) return cached
  const flows = condenseFlows(await requestDataset<InstitutionalRow>('TaiwanStockInstitutionalInvestorsBuySell', code, start, fetcher))
  writeCache(key, flows)
  return flows
}

export interface ChipSnapshot {
  date: string
  // Lots (張 = 1,000 shares).
  foreign5: number
  foreign20: number
  foreign60: number
  // Foreign 20-day net buying as % of 20-day traded volume.
  foreign20OfVolume: number | null
  // Consecutive days of foreign net buying (> 0) or selling (< 0).
  foreignStreak: number
  trust20: number
  trust60: number
  foreignRatio: number | null
  foreignRatioChange20: number | null
  foreignRatioChange60: number | null
  // Margin balance change over 20 days (%), and short ÷ margin (%).
  marginChange20: number | null
  shortMarginRatio: number | null
}

const lots = (shares: number) => Math.round(shares / 1000)
const round1 = (v: number) => Math.round(v * 10) / 10

function sumLast(rows: FlowRow[], days: number, col: 1 | 2): number {
  return rows.slice(-days).reduce((a, r) => a + r[col], 0)
}

export function chipSnapshot(input: {
  flows: FlowRow[]
  margin: { date: string; margin: number; short: number }[]
  ratio: { date: string; ratio: number }[]
  // Daily traded shares, oldest first.
  volumes: number[]
}): ChipSnapshot | null {
  const { flows, margin, ratio, volumes } = input
  if (flows.length < 5) return null
  let streak = 0
  for (let i = flows.length - 1; i >= 0; i--) {
    const f = flows[i][1]
    if (f === 0 || (streak > 0 && f < 0) || (streak < 0 && f > 0)) break
    streak += f > 0 ? 1 : -1
  }
  const vol20 = volumes.slice(-20).reduce((a, v) => a + v, 0)
  const f20 = sumLast(flows, 20, 1)
  const ratioAgo = (n: number) => (ratio.length > n ? ratio[ratio.length - 1 - n].ratio : null)
  const lastRatio = ratio.at(-1)?.ratio ?? null
  const lastMargin = margin.at(-1)
  const margin20 = margin.length > 20 ? margin[margin.length - 21].margin : null
  return {
    date: flows[flows.length - 1][0],
    foreign5: lots(sumLast(flows, 5, 1)),
    foreign20: lots(f20),
    foreign60: lots(sumLast(flows, 60, 1)),
    foreign20OfVolume: vol20 > 0 ? round1((f20 / vol20) * 100) : null,
    foreignStreak: streak,
    trust20: lots(sumLast(flows, 20, 2)),
    trust60: lots(sumLast(flows, 60, 2)),
    foreignRatio: lastRatio,
    foreignRatioChange20: lastRatio !== null && ratioAgo(20) !== null ? Math.round((lastRatio - ratioAgo(20)!) * 100) / 100 : null,
    foreignRatioChange60: lastRatio !== null && ratioAgo(60) !== null ? Math.round((lastRatio - ratioAgo(60)!) * 100) / 100 : null,
    marginChange20: lastMargin && margin20 ? round1((lastMargin.margin / margin20 - 1) * 100) : null,
    shortMarginRatio: lastMargin && lastMargin.margin > 0 ? round1((lastMargin.short / lastMargin.margin) * 100) : null,
  }
}

// The research card's snapshot over roughly the last four months.
export async function fetchChipSnapshot(
  code: string,
  start: string,
  volumes: number[],
  fetcher?: Fetcher,
): Promise<ChipSnapshot | null> {
  const [flows, margin, holding] = await Promise.all([
    loadChipFlows(code, start, fetcher),
    fetchDataset<MarginRow>('TaiwanStockMarginPurchaseShortSale', code, start, fetcher),
    fetchDataset<HoldingRow>('TaiwanStockShareholding', code, start, fetcher),
  ])
  return chipSnapshot({
    flows,
    margin: margin.map((m) => ({ date: m.date, margin: m.MarginPurchaseTodayBalance, short: m.ShortSaleTodayBalance })),
    ratio: holding.filter((h) => h.ForeignInvestmentSharesRatio > 0).map((h) => ({ date: h.date, ratio: h.ForeignInvestmentSharesRatio })),
    volumes,
  })
}
