import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { upsertSnapshot } from '../calculations/netWorth'
import {
  AppDataSchema,
  SCHEMA_VERSION,
  createDefaultAppData,
  type AppData,
  type UserProfile,
  type FireAssumptions,
  type AdviceGuardrails,
  type NetWorthCheckIn,
  type MarketCheckIn,
  type DailyClose,
  type MonthlyRecord,
  type InvestmentPolicy,
  type MacroCheckIn,
  type StockThesis,
  type Holding,
  type PortfolioMeta,
  type Trade,
  type PerformanceReview,
  type Foundation,
  type MarketSnapshot,
  type ResearchReport,
  type FubonOutlook,
  type TradingStrategy,
  type BacktestRun,
  type PaperAccount,
  type WatchItem,
} from './schema'

// Keep localStorage bounded: only the most recent reports are stored.
export const MAX_RESEARCH_REPORTS = 30

export const STORAGE_KEY = 'pfm:appData'
const BACKUP_SUFFIX = ':corrupted-backup'

// Records across all lists, to compare two saved copies.
function recordCount(state: Record<string, unknown>): number {
  return Object.values(state).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0)
}

// Data that once failed validation was moved to the backup key and the app
// started over. When the backup validates now (after a schema fix) and holds
// more records than the current copy, bring it back.
function restoreBackup(name: string, raw: string | null): string | null {
  const backup = localStorage.getItem(`${name}${BACKUP_SUFFIX}`)
  if (!backup) return raw
  try {
    const parsed = JSON.parse(backup)
    const result = AppDataSchema.safeParse(parsed.state)
    if (!result.success) return raw
    const current = raw ? AppDataSchema.safeParse(JSON.parse(raw).state) : null
    if (current?.success && recordCount(current.data) >= recordCount(result.data)) return raw
    if (raw) localStorage.setItem(`${name}:before-restore`, raw)
    localStorage.setItem(name, backup)
    localStorage.removeItem(`${name}${BACKUP_SUFFIX}`)
    console.warn('[appStore] 已從備份還原先前無法讀取的本機資料。')
    return backup
  } catch {
    return raw
  }
}

const validatingStorage: StateStorage = {
  getItem: (name) => {
    const raw = restoreBackup(name, localStorage.getItem(name))
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      const result = AppDataSchema.safeParse(parsed.state)
      if (!result.success) {
        localStorage.setItem(`${name}${BACKUP_SUFFIX}`, raw)
        console.warn(
          `[appStore] 本機資料驗證失敗，已備份至 ${name}${BACKUP_SUFFIX}，改用預設資料。`,
          result.error,
        )
        return null
      }
      // Return the validated/transformed data, not the raw string — zod
      // defaults and preprocess-based migrations (e.g. schema evolutions)
      // only take effect if callers see result.data, not the original JSON.
      return JSON.stringify({ ...parsed, state: result.data })
    } catch (error) {
      localStorage.setItem(`${name}${BACKUP_SUFFIX}`, raw)
      console.warn(
        `[appStore] 本機資料解析失敗，已備份至 ${name}${BACKUP_SUFFIX}，改用預設資料。`,
        error,
      )
      return null
    }
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
}

interface AppStore extends AppData {
  setProfile: (profile: Partial<Omit<UserProfile, 'updatedAt'>>) => void
  setAssumptions: (assumptions: Partial<Omit<FireAssumptions, 'updatedAt'>>) => void
  setGuardrails: (guardrails: Partial<AdviceGuardrails>) => void
  setInvestmentPolicy: (policy: Partial<Omit<InvestmentPolicy, 'updatedAt'>>) => void
  addCheckIn: (entry: Omit<NetWorthCheckIn, 'id' | 'createdAt'>) => void
  updateCheckIn: (id: string, entry: Partial<Omit<NetWorthCheckIn, 'id' | 'createdAt'>>) => void
  removeCheckIn: (id: string) => void
  addMarketCheckIn: (entry: Omit<MarketCheckIn, 'id' | 'createdAt'>) => void
  updateMarketCheckIn: (
    id: string,
    entry: Partial<Omit<MarketCheckIn, 'id' | 'createdAt'>>,
  ) => void
  removeMarketCheckIn: (id: string) => void
  addMonthlyRecord: (entry: Omit<MonthlyRecord, 'id' | 'createdAt'>) => void
  updateMonthlyRecord: (
    id: string,
    entry: Partial<Omit<MonthlyRecord, 'id' | 'createdAt'>>,
  ) => void
  removeMonthlyRecord: (id: string) => void
  addMacroCheckIn: (entry: Omit<MacroCheckIn, 'id' | 'createdAt'>) => void
  updateMacroCheckIn: (id: string, entry: Partial<Omit<MacroCheckIn, 'id' | 'createdAt'>>) => void
  removeMacroCheckIn: (id: string) => void
  // One check-in per month: an automatic refresh replaces that month's entry.
  upsertMonthlyMacroCheckIn: (entry: Omit<MacroCheckIn, 'id' | 'createdAt'>) => void
  addStockThesis: (entry: Omit<StockThesis, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateStockThesis: (
    id: string,
    entry: Partial<Omit<StockThesis, 'id' | 'createdAt' | 'updatedAt'>>,
  ) => void
  removeStockThesis: (id: string) => void
  addHolding: (entry: Omit<Holding, 'id' | 'createdAt'>) => string
  updateHolding: (id: string, entry: Partial<Omit<Holding, 'id' | 'createdAt'>>) => void
  removeHolding: (id: string) => void
  setPortfolioMeta: (meta: Partial<PortfolioMeta>) => void
  recordPortfolioValue: (totalValueTwd: number, date: string) => void
  addTrade: (entry: Omit<Trade, 'id' | 'createdAt'>) => string
  updateTrade: (id: string, entry: Partial<Omit<Trade, 'id' | 'createdAt'>>) => void
  removeTrade: (id: string) => void
  addPerformanceReview: (entry: Omit<PerformanceReview, 'id' | 'createdAt'>) => void
  removePerformanceReview: (id: string) => void
  setFoundation: (foundation: Partial<Foundation>) => void
  setMarketSnapshot: (snapshot: MarketSnapshot) => void
  // Market price refresh: leaves updatedAt alone so a daily price update does
  // not count as the user reviewing the research card.
  setThesisPrices: (prices: Record<string, number>) => void
  addResearchReport: (entry: Omit<ResearchReport, 'id' | 'createdAt'>) => string
  removeResearchReport: (id: string) => void
  // Stores a Fubon digest; re-digesting the same report replaces it.
  upsertFubonOutlook: (entry: Omit<FubonOutlook, 'id' | 'createdAt'>) => string
  removeFubonOutlook: (id: string) => void
  addTradingStrategy: (entry: Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateTradingStrategy: (
    id: string,
    entry: Partial<Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt'>>,
  ) => void
  removeTradingStrategy: (id: string) => void
  addBacktestRun: (entry: Omit<BacktestRun, 'id' | 'createdAt'>) => string
  removeBacktestRun: (id: string) => void
  addPaperAccount: (entry: Omit<PaperAccount, 'id' | 'createdAt'>) => string
  // Paper-account changes are computed by pure functions and saved whole.
  replacePaperAccount: (account: PaperAccount) => void
  removePaperAccount: (id: string) => void
  // Adding a symbol already on the list keeps the original entry.
  addWatchItem: (entry: Omit<WatchItem, 'addedAt'>) => void
  updateWatchItem: (symbol: string, entry: Partial<Omit<WatchItem, 'symbol' | 'addedAt'>>) => void
  removeWatchItem: (symbol: string) => void
  mergeMarketPriceHistory: (
    taiex: DailyClose[],
    tw0050: DailyClose[],
    fetchedOn: string,
  ) => void
  resetAllData: () => void
  importData: (data: AppData) => void
}

function toAppData(state: AppData): AppData {
  return {
    schemaVersion: state.schemaVersion,
    profile: state.profile,
    assumptions: state.assumptions,
    guardrails: state.guardrails,
    checkIns: state.checkIns,
    marketCheckIns: state.marketCheckIns,
    marketPriceHistory: state.marketPriceHistory,
    monthlyRecords: state.monthlyRecords,
    investmentPolicy: state.investmentPolicy,
    macroCheckIns: state.macroCheckIns,
    stockTheses: state.stockTheses,
    holdings: state.holdings,
    portfolioMeta: state.portfolioMeta,
    trades: state.trades,
    performanceReviews: state.performanceReviews,
    foundation: state.foundation,
    marketSnapshot: state.marketSnapshot,
    researchReports: state.researchReports,
    portfolioSnapshots: state.portfolioSnapshots,
    fubonOutlooks: state.fubonOutlooks,
    tradingStrategies: state.tradingStrategies,
    backtestRuns: state.backtestRuns,
    paperAccounts: state.paperAccounts,
    watchlist: state.watchlist,
  }
}

// Keep localStorage bounded: only the most recent backtests are stored.
export const MAX_BACKTEST_RUNS = 40

export function exportAppData(): AppData {
  return toAppData(useAppStore.getState())
}

function mergeByDate(existing: DailyClose[], incoming: DailyClose[]): DailyClose[] {
  const byDate = new Map(existing.map((point) => [point.date, point]))
  for (const point of incoming) byDate.set(point.date, point)
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...createDefaultAppData(),

      setProfile: (profile) =>
        set((state) => ({
          profile: { ...state.profile, ...profile, updatedAt: new Date().toISOString() },
        })),

      setAssumptions: (assumptions) =>
        set((state) => ({
          assumptions: {
            ...state.assumptions,
            ...assumptions,
            updatedAt: new Date().toISOString(),
          },
        })),

      setGuardrails: (guardrails) =>
        set((state) => ({ guardrails: { ...state.guardrails, ...guardrails } })),

      setInvestmentPolicy: (policy) =>
        set((state) => ({
          investmentPolicy: {
            ...state.investmentPolicy,
            ...policy,
            updatedAt: new Date().toISOString(),
          },
        })),

      addCheckIn: (entry) =>
        set((state) => ({
          checkIns: [
            ...state.checkIns,
            { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),

      updateCheckIn: (id, entry) =>
        set((state) => ({
          checkIns: state.checkIns.map((c) => (c.id === id ? { ...c, ...entry } : c)),
        })),

      removeCheckIn: (id) =>
        set((state) => ({ checkIns: state.checkIns.filter((c) => c.id !== id) })),

      addMarketCheckIn: (entry) =>
        set((state) => ({
          marketCheckIns: [
            ...state.marketCheckIns,
            { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),

      updateMarketCheckIn: (id, entry) =>
        set((state) => ({
          marketCheckIns: state.marketCheckIns.map((c) =>
            c.id === id ? { ...c, ...entry } : c,
          ),
        })),

      removeMarketCheckIn: (id) =>
        set((state) => ({
          marketCheckIns: state.marketCheckIns.filter((c) => c.id !== id),
        })),

      addMonthlyRecord: (entry) =>
        set((state) => ({
          monthlyRecords: [
            ...state.monthlyRecords,
            { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),

      updateMonthlyRecord: (id, entry) =>
        set((state) => ({
          monthlyRecords: state.monthlyRecords.map((r) =>
            r.id === id ? { ...r, ...entry } : r,
          ),
        })),

      removeMonthlyRecord: (id) =>
        set((state) => ({
          monthlyRecords: state.monthlyRecords.filter((r) => r.id !== id),
        })),

      addMacroCheckIn: (entry) =>
        set((state) => ({
          macroCheckIns: [
            ...state.macroCheckIns,
            { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),

      updateMacroCheckIn: (id, entry) =>
        set((state) => ({
          macroCheckIns: state.macroCheckIns.map((c) => (c.id === id ? { ...c, ...entry } : c)),
        })),

      upsertMonthlyMacroCheckIn: (entry) =>
        set((state) => ({
          macroCheckIns: [
            ...state.macroCheckIns.filter((c) => c.date.slice(0, 7) !== entry.date.slice(0, 7)),
            { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),

      removeMacroCheckIn: (id) =>
        set((state) => ({ macroCheckIns: state.macroCheckIns.filter((c) => c.id !== id) })),

      addStockThesis: (entry) => {
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        set((state) => ({
          stockTheses: [...state.stockTheses, { ...entry, id, createdAt: now, updatedAt: now }],
        }))
        return id
      },

      updateStockThesis: (id, entry) =>
        set((state) => ({
          stockTheses: state.stockTheses.map((t) =>
            t.id === id ? { ...t, ...entry, updatedAt: new Date().toISOString() } : t,
          ),
        })),

      removeStockThesis: (id) =>
        set((state) => ({ stockTheses: state.stockTheses.filter((t) => t.id !== id) })),

      addHolding: (entry) => {
        const id = crypto.randomUUID()
        set((state) => ({
          holdings: [...state.holdings, { ...entry, id, createdAt: new Date().toISOString() }],
        }))
        return id
      },

      updateHolding: (id, entry) =>
        set((state) => ({
          holdings: state.holdings.map((h) => (h.id === id ? { ...h, ...entry } : h)),
        })),

      removeHolding: (id) =>
        set((state) => ({ holdings: state.holdings.filter((h) => h.id !== id) })),

      setPortfolioMeta: (meta) =>
        set((state) => ({ portfolioMeta: { ...state.portfolioMeta, ...meta } })),

      // Tracks the peak (for the drawdown circuit breaker) and the monthly
      // net-worth history from the same portfolio value.
      recordPortfolioValue: (totalValueTwd, date) =>
        set((state) => {
          const latest = state.portfolioSnapshots.find((s) => s.month === date.slice(0, 7))
          const snapshotChanged = !latest || latest.valueTwd !== totalValueTwd || latest.date !== date
          const newPeak = totalValueTwd > state.portfolioMeta.peakValueTwd
          if (!snapshotChanged && !newPeak) return {}
          return {
            ...(snapshotChanged
              ? { portfolioSnapshots: upsertSnapshot(state.portfolioSnapshots, totalValueTwd, date) }
              : {}),
            ...(newPeak
              ? { portfolioMeta: { ...state.portfolioMeta, peakValueTwd: totalValueTwd, peakDate: date } }
              : {}),
          }
        }),

      addTrade: (entry) => {
        const id = crypto.randomUUID()
        set((state) => ({
          trades: [...state.trades, { ...entry, id, createdAt: new Date().toISOString() }],
        }))
        return id
      },

      updateTrade: (id, entry) =>
        set((state) => ({
          trades: state.trades.map((t) => (t.id === id ? { ...t, ...entry } : t)),
        })),

      removeTrade: (id) => set((state) => ({ trades: state.trades.filter((t) => t.id !== id) })),

      addPerformanceReview: (entry) =>
        set((state) => ({
          performanceReviews: [
            ...state.performanceReviews,
            { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
          ],
        })),

      removePerformanceReview: (id) =>
        set((state) => ({
          performanceReviews: state.performanceReviews.filter((r) => r.id !== id),
        })),

      setFoundation: (foundation) =>
        set((state) => ({ foundation: { ...state.foundation, ...foundation } })),

      setMarketSnapshot: (snapshot) => set({ marketSnapshot: snapshot }),

      setThesisPrices: (prices) =>
        set((state) => ({
          stockTheses: state.stockTheses.map((t) =>
            prices[t.id] !== undefined ? { ...t, currentPrice: prices[t.id] } : t,
          ),
        })),

      addResearchReport: (entry) => {
        const id = crypto.randomUUID()
        set((state) => ({
          researchReports: [
            ...state.researchReports,
            { ...entry, id, createdAt: new Date().toISOString() },
          ].slice(-MAX_RESEARCH_REPORTS),
        }))
        return id
      },

      upsertFubonOutlook: (entry) => {
        const sameReport = (o: FubonOutlook) =>
          o.reportTitle === entry.reportTitle && o.reportDate === entry.reportDate
        // Keep the id of a re-digested report so analyses still point to it.
        const id = get().fubonOutlooks.find(sameReport)?.id ?? crypto.randomUUID()
        set((state) => ({
          fubonOutlooks: [
            ...state.fubonOutlooks.filter((o) => !sameReport(o)),
            { ...entry, id, createdAt: new Date().toISOString() },
          ].sort((a, b) => a.reportDate.localeCompare(b.reportDate)),
        }))
        return id
      },

      addTradingStrategy: (entry) => {
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        set((state) => ({
          tradingStrategies: [...state.tradingStrategies, { ...entry, id, createdAt: now, updatedAt: now }],
        }))
        return id
      },

      updateTradingStrategy: (id, entry) =>
        set((state) => ({
          tradingStrategies: state.tradingStrategies.map((t) =>
            t.id === id ? { ...t, ...entry, updatedAt: new Date().toISOString() } : t,
          ),
        })),

      removeTradingStrategy: (id) =>
        set((state) => ({ tradingStrategies: state.tradingStrategies.filter((t) => t.id !== id) })),

      addBacktestRun: (entry) => {
        const id = crypto.randomUUID()
        set((state) => ({
          backtestRuns: [...state.backtestRuns, { ...entry, id, createdAt: new Date().toISOString() }].slice(
            -MAX_BACKTEST_RUNS,
          ),
        }))
        return id
      },

      removeBacktestRun: (id) =>
        set((state) => ({ backtestRuns: state.backtestRuns.filter((r) => r.id !== id) })),

      addPaperAccount: (entry) => {
        const id = crypto.randomUUID()
        set((state) => ({
          paperAccounts: [...state.paperAccounts, { ...entry, id, createdAt: new Date().toISOString() }],
        }))
        return id
      },

      replacePaperAccount: (account) =>
        set((state) => ({ paperAccounts: state.paperAccounts.map((a) => (a.id === account.id ? account : a)) })),

      addWatchItem: (entry) =>
        set((state) =>
          state.watchlist.some((w) => w.symbol === entry.symbol)
            ? state
            : { watchlist: [...state.watchlist, { ...entry, addedAt: new Date().toISOString().slice(0, 10) }] },
        ),

      updateWatchItem: (symbol, entry) =>
        set((state) => ({ watchlist: state.watchlist.map((w) => (w.symbol === symbol ? { ...w, ...entry } : w)) })),

      removeWatchItem: (symbol) => set((state) => ({ watchlist: state.watchlist.filter((w) => w.symbol !== symbol) })),

      removePaperAccount: (id) =>
        set((state) => ({ paperAccounts: state.paperAccounts.filter((a) => a.id !== id) })),

      removeFubonOutlook: (id) =>
        set((state) => ({ fubonOutlooks: state.fubonOutlooks.filter((o) => o.id !== id) })),

      removeResearchReport: (id) =>
        set((state) => ({ researchReports: state.researchReports.filter((r) => r.id !== id) })),

      mergeMarketPriceHistory: (taiex, tw0050, fetchedOn) =>
        set((state) => ({
          marketPriceHistory: {
            taiex: mergeByDate(state.marketPriceHistory.taiex, taiex),
            tw0050: mergeByDate(state.marketPriceHistory.tw0050, tw0050),
            lastFetchedDate: fetchedOn,
          },
        })),

      resetAllData: () => set(createDefaultAppData()),

      importData: (data) => set(toAppData(data)),
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => validatingStorage),
      partialize: (state) => toAppData(state),
    },
  ),
)
