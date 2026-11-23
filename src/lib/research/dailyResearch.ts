import type { BacktestRun, LibraryTemplate, StockThesis, StrategyComparison, TradingStrategy } from '../storage/schema'
import { findDuplicate } from '../backtest/cardGroups'
import { cardDraftOf, reliablePass, runDraftOf } from '../backtest/comparisonCard'
import type { StockRow } from '../screener/stockData'
import { applyScreen, PRESET_SCREENS, type PresetScreen } from '../screener/screens'
import type { AutoResearch } from './autoResearch'
import { derivedFields } from './autoResearch'
import { draftThesis } from './batchResearch'
import type { OverallRating } from './rating'

// Daily automatic research (handbook 06 §1.1): at 06:00 a GitHub Actions
// job picks one stock from each of seven screens, runs the health check,
// and backtests every library template on those rated 留意 or better
// (scripts/daily-research.mts). The results are published with the site
// and imported into the research cards and comparisons when the site opens.

export const DAILY_RESEARCH_PATH = 'data/daily-research.json'
export const DAILY_SCREEN_IDS = ['value', 'growth', 'momentum', 'weekly-momentum', 'income', 'large', 'etf-momentum']
// A stock researched automatically within this many days is skipped.
export const REPICK_DAYS = 30
export const KEEP_RUNS = 7
export const KEEP_LOG_DAYS = 60
// Automatic comparisons kept, apart from the ones you run yourself.
export const MAX_AUTO_COMPARISONS = 20

// A saved comparison without its curve (too large to keep every day).
export type DailyComparison = Omit<StrategyComparison, 'id' | 'createdAt'>

export interface DailyItem {
  screenId: string
  screenName: string
  code: string
  name: string
  auto?: AutoResearch
  rating?: OverallRating
  comparison?: DailyComparison
  error?: string
}

export interface DailyRun {
  date: string
  // The trading day of the screener data it picked from (stocks.json).
  marketDate?: string
  items: DailyItem[]
  // Screens with nothing left to pick.
  skipped: { screenName: string; reason: string }[]
}

export interface DailyResearchFile {
  generatedAt: string
  runs: DailyRun[]
  log: { code: string; date: string }[]
}

export const qualifies = (rating: OverallRating | undefined) => rating === 'strong' || rating === 'caution'

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000

// A screen whose candidates come from elsewhere, already ranked (the active
// ETF consensus, lib/research/activeEtf.ts).
export interface ExtraScreen {
  screenId: string
  screenName: string
  candidates: { code: string; name: string }[]
}

export const ACTIVE_CONSENSUS_SCREEN = { screenId: 'active-consensus', screenName: '主動 ETF 共識' }

// One stock per screen: the top-ranked one not researched automatically in
// the last 30 days and not picked by an earlier screen today.
export function pickDaily(stocks: StockRow[], log: DailyResearchFile['log'], today: string, extra: ExtraScreen[] = [], presets: PresetScreen[] = PRESET_SCREENS) {
  const recent = new Set(log.filter((l) => daysBetween(l.date, today) < REPICK_DAYS).map((l) => l.code))
  const picks: { screenId: string; screenName: string; code: string; name: string }[] = []
  const skipped: DailyRun['skipped'] = []
  const screens: ExtraScreen[] = [
    ...DAILY_SCREEN_IDS.flatMap((id) => {
      const preset = presets.find((p) => p.id === id)
      return preset ? [{ screenId: id, screenName: preset.name, candidates: applyScreen(stocks, preset.screen) }] : []
    }),
    ...extra,
  ]
  for (const { screenId, screenName, candidates } of screens) {
    const pick = candidates.find((s) => !recent.has(s.code) && !picks.some((p) => p.code === s.code))
    if (pick) picks.push({ screenId, screenName, code: pick.code, name: pick.name })
    else skipped.push({ screenName, reason: candidates.length === 0 ? '今天沒有符合的標的' : `符合的 ${candidates.length} 檔都在 ${REPICK_DAYS} 天內研究過` })
  }
  return { picks, skipped }
}

// Research once per trading day: on a Taiwan weekday, with screener data
// from a trading day not researched yet. Weekends and holidays (the data
// stays on the last trading day) are skipped, so after a break each screen
// still gets one stock, not one per day off.
export function researchDue(today: string, marketDate: string, runs: DailyRun[]): { due: boolean; reason: string } {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return { due: false, reason: `${today} 是週末，不研究` }
  if (runs.some((r) => r.date === today)) return { due: false, reason: `${today} 已研究過` }
  if (runs.some((r) => r.marketDate === marketDate)) return { due: false, reason: `${marketDate} 的收盤資料已研究過（假日或資料尚未更新）` }
  return { due: true, reason: '' }
}

// The newest run replaces one of the same date; older runs and the log age out.
export function mergeRuns(prev: DailyResearchFile | null, run: DailyRun, generatedAt: string): DailyResearchFile {
  const runs = [...(prev?.runs ?? []).filter((r) => r.date !== run.date), run].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP_RUNS)
  const log = [
    ...(prev?.log ?? []).filter((l) => l.date !== run.date && daysBetween(l.date, run.date) < KEEP_LOG_DAYS),
    ...run.items.map((i) => ({ code: i.code, date: run.date })),
  ]
  return { generatedAt, runs, log }
}

const autoKey = (c: Pick<StrategyComparison, 'auto' | 'symbol'>) => (c.auto ? c.symbol : null)

// A run imported into the saved data: new cards for new codes, a fresh
// health check (verdict and notes kept) for existing ones, and the
// comparisons, an automatic one replacing the older automatic one for the
// same symbol. Your own comparisons are never touched.
type DailyData = { stockTheses: StockThesis[]; strategyComparisons: StrategyComparison[]; tradingStrategies: TradingStrategy[]; backtestRuns: BacktestRun[] }

export function applyDailyRun(
  data: DailyData,
  run: DailyRun,
  now: string,
  newId: () => string,
  cards: { library: LibraryTemplate[]; riskPercent: number },
): DailyData {
  let theses = data.stockTheses
  const added: StrategyComparison[] = []
  for (const item of run.items) {
    if (!item.auto) continue
    const origin = { screen: item.screenName, date: run.date }
    const existing = theses.find((t) => t.ticker.trim().toUpperCase() === item.code)
    let thesisId: string
    if (existing) {
      thesisId = existing.id
      // A newer check made on the device stays.
      if (!existing.auto || existing.auto.fetchedAt < item.auto.fetchedAt) {
        const fresh = { auto: item.auto, kind: item.auto.kind, ...derivedFields(item.auto, existing.assumptions, existing.explainedFlags ?? {}) }
        theses = theses.map((t) => (t.id === existing.id ? { ...t, ...fresh, updatedAt: now } : t))
      }
    } else {
      thesisId = newId()
      theses = [...theses, { ...draftThesis(item.code, item.auto), autoOrigin: origin, id: thesisId, createdAt: now, updatedAt: now }]
    }
    if (item.comparison) added.push({ ...item.comparison, thesisId, auto: origin, id: newId(), createdAt: now })
  }
  const replaced = new Set(added.map((c) => c.symbol))
  const own = data.strategyComparisons.filter((c) => !c.auto)
  const autos = [...data.strategyComparisons.filter((c) => c.auto && !replaced.has(autoKey(c) ?? '')), ...added].slice(-MAX_AUTO_COMPARISONS)
  // Keep the saved order: oldest first.
  const comparisons = [...own, ...autos].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // A template that passed with enough trades becomes a card (開發中) with
  // this comparison as its backtest; one already there is left alone.
  let strategies = data.tradingStrategies
  let runs = data.backtestRuns
  for (const c of added) {
    for (const row of c.rows.filter(reliablePass)) {
      const note = `每日自動研究（${c.auto?.screen}，${run.date}）建立：樣本外通過、交易 ${row.stats?.full.trades} 筆。${row.verdictReason}`
      const draft = cardDraftOf(c, row, cards.library, cards.riskPercent, note)
      if (findDuplicate(strategies, draft)) continue
      const id = newId()
      strategies = [...strategies, { ...draft, id, createdAt: now, updatedAt: now }]
      const r = runDraftOf(c, row, id)
      if (r) runs = [...runs, { ...r, id: newId(), createdAt: now }]
    }
  }
  return { stockTheses: theses, strategyComparisons: comparisons, tradingStrategies: strategies, backtestRuns: runs }
}

// Runs not yet imported, oldest first.
export const runsToImport = (file: DailyResearchFile, imported: string | undefined) => file.runs.filter((r) => !imported || r.date > imported)

export function runSummary(run: DailyRun): string {
  const researched = run.items.filter((i) => i.auto).length
  const tested = run.items.filter((i) => i.comparison).length
  const failed = run.items.filter((i) => i.error)
  return `研究 ${researched} 檔，${tested} 檔留意以上已回測${failed.length > 0 ? `；${failed.length} 檔失敗（${failed.map((f) => `${f.code}：${f.error}`).join('、')}）` : ''}`
}

export async function fetchDailyResearch(base: string = import.meta.env.BASE_URL): Promise<DailyResearchFile | null> {
  try {
    const response = await fetch(`${base}${DAILY_RESEARCH_PATH}`, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as DailyResearchFile
  } catch {
    return null
  }
}
