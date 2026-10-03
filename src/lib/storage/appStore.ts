import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
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
} from './schema'

export const STORAGE_KEY = 'pfm:appData'
const BACKUP_SUFFIX = ':corrupted-backup'

const validatingStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name)
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
  }
}

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
    (set) => ({
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

      recordPortfolioValue: (totalValueTwd, date) =>
        set((state) =>
          totalValueTwd > state.portfolioMeta.peakValueTwd
            ? {
                portfolioMeta: {
                  ...state.portfolioMeta,
                  peakValueTwd: totalValueTwd,
                  peakDate: date,
                },
              }
            : {},
        ),

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
