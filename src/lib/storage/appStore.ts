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
      return raw
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
  addCheckIn: (entry: Omit<NetWorthCheckIn, 'id' | 'createdAt'>) => void
  updateCheckIn: (id: string, entry: Partial<Omit<NetWorthCheckIn, 'id' | 'createdAt'>>) => void
  removeCheckIn: (id: string) => void
  addMarketCheckIn: (entry: Omit<MarketCheckIn, 'id' | 'createdAt'>) => void
  removeMarketCheckIn: (id: string) => void
  mergeMarketPriceHistory: (
    taiex: DailyClose[],
    tw0050: DailyClose[],
    fetchedOn: string,
  ) => void
  resetAllData: () => void
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

      removeMarketCheckIn: (id) =>
        set((state) => ({
          marketCheckIns: state.marketCheckIns.filter((c) => c.id !== id),
        })),

      mergeMarketPriceHistory: (taiex, tw0050, fetchedOn) =>
        set((state) => ({
          marketPriceHistory: {
            taiex: mergeByDate(state.marketPriceHistory.taiex, taiex),
            tw0050: mergeByDate(state.marketPriceHistory.tw0050, tw0050),
            lastFetchedDate: fetchedOn,
          },
        })),

      resetAllData: () => set(createDefaultAppData()),
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => validatingStorage),
      partialize: (state): AppData => ({
        schemaVersion: state.schemaVersion,
        profile: state.profile,
        assumptions: state.assumptions,
        guardrails: state.guardrails,
        checkIns: state.checkIns,
        marketCheckIns: state.marketCheckIns,
        marketPriceHistory: state.marketPriceHistory,
      }),
    },
  ),
)
