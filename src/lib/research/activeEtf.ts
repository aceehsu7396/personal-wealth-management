// The three largest Taiwan active ETFs and what their managers hold each day
// (handbook 06 §1.2). Holdings and fund sizes come from the open-source
// project nctuwanglin/active-etf (active.json, built from the fund
// companies' daily PCF); each fund whose company site lets a script in
// (統一, 復華) is then checked against that site for the same day
// (scripts/active-etf.mts). 中信 blocks scripted access, so its funds stay
// unchecked.

export const ACTIVE_ETF_PATH = 'data/active-etf.json'
export const THIRD_PARTY_URL = 'https://nctuwanglin.github.io/active-etf/active.json'
export const THIRD_PARTY_LABEL = '開源專案 active-etf（nctuwanglin）'
export const TOP_COUNT = 3
export const KEEP_DAYS = 60
// Weights may differ by rounding; shares must match exactly.
export const WEIGHT_TOLERANCE = 0.05
// Data older than this many days is flagged on the page.
export const STALE_DAYS = 3

export interface Holding {
  code: string
  name: string
  shares: number
  weight: number
}

export interface CheckDiff {
  code: string
  name: string
  third: { shares: number; weight: number } | null
  official: { shares: number; weight: number } | null
}

export interface OfficialCheck {
  status: 'match' | 'mismatch' | 'unverified'
  officialDate: string | null
  diffs: CheckDiff[]
  note: string
}

export interface EtfSnapshot {
  code: string
  name: string
  issuer: string
  // NT dollars.
  scale: number
  dataDate: string
  holdings: Holding[]
  check?: OfficialCheck
}

export interface RankedEtf {
  code: string
  name: string
  issuer: string
  scale: number
}

export interface ActiveEtfFile {
  generatedAt: string
  // The third-party file's own date, to tell when it stops updating.
  sourceUpdated: string | null
  top: string[]
  ranking: RankedEtf[]
  // Each fund's daily snapshots, oldest first.
  history: Record<string, EtfSnapshot[]>
  errors: string[]
}

// Fund companies whose own site is checked, by the name's company.
export const CHECKED_ISSUERS = ['統一', '復華']

const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,%\s]/g, '')))
// Taiwan stocks and ETFs (2330, 0050, 00878, 2881A); not "TSLA US" or cash.
const isTaiwanCode = (code: string) => /^\d{4}[0-9A-Z]{0,2}$/.test(code)
const isActiveTw = (code: string) => /^00\d{3}A$/.test(code)

// 2026-11-19, from "2026-11-19T00:00:00", "2026/11/19" or a .NET
// "/Date(ms)/" (midnight Taiwan time).
export function isoDate(v: unknown): string | null {
  const s = String(v ?? '')
  const ms = /\/Date\((-?\d+)\)\//.exec(s)
  if (ms) return new Date(Number(ms[1]) + 8 * 3600_000).toISOString().slice(0, 10)
  const d = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s)
  return d ? `${d[1]}-${d[2]}-${d[3]}` : null
}

function stocksOnly(holdings: Holding[]): Holding[] {
  return holdings.filter((h) => isTaiwanCode(h.code) && h.shares > 0).sort((a, b) => b.weight - a.weight)
}

// --- Third party (the data shown) ------------------------------------------

interface ThirdPartyEtf {
  name?: string
  issuer?: string
  scale?: number | null
  data_date?: string | null
  status?: string
  holdings?: { code: string; name: string; shares: number; weight: number }[]
}

export function parseThirdParty(json: unknown): { updated: string | null; etfs: EtfSnapshot[] } {
  const j = json as { updated?: string; etfs?: Record<string, ThirdPartyEtf> }
  const etfs = Object.entries(j.etfs ?? {})
    .filter(([, e]) => e.data_date && Array.isArray(e.holdings))
    .map(([code, e]) => ({
      code,
      name: e.name ?? code,
      issuer: e.issuer ?? '',
      scale: num(e.scale ?? 0),
      dataDate: isoDate(e.data_date) ?? '',
      holdings: stocksOnly((e.holdings ?? []).map((h) => ({ code: String(h.code).trim(), name: h.name, shares: num(h.shares), weight: num(h.weight) }))),
    }))
  return { updated: j.updated ?? null, etfs }
}

// A day of the project's history (data/history/YYYY-MM-DD.json): the same
// holdings, with the size under meta and no names; names come from today's.
export const THIRD_PARTY_HISTORY = 'https://nctuwanglin.github.io/active-etf/data/history/'
export const THIRD_PARTY_HISTORY_LIST = 'https://api.github.com/repos/nctuwanglin/active-etf/contents/data/history'

export function parseThirdPartyHistory(json: unknown, codes: string[], current: EtfSnapshot[]): EtfSnapshot[] {
  const j = json as { etfs?: Record<string, ThirdPartyEtf & { meta?: { scale?: number } }> }
  return codes.flatMap((code) => {
    const e = j.etfs?.[code]
    const now = current.find((c) => c.code === code)
    if (!e?.data_date || !Array.isArray(e.holdings) || e.status === 'stale') return []
    return [
      {
        code,
        name: now?.name ?? code,
        issuer: now?.issuer ?? '',
        scale: num(e.meta?.scale ?? 0),
        dataDate: isoDate(e.data_date) ?? '',
        holdings: stocksOnly(e.holdings.map((h) => ({ code: String(h.code).trim(), name: h.name, shares: num(h.shares), weight: num(h.weight) }))),
        check: unverified('補入的歷史資料，未與官網比對'),
      },
    ]
  })
}

// The largest Taiwan-equity active ETFs (most of the weight in Taiwan
// stocks; bond and overseas funds are left out).
export function topByScale(etfs: EtfSnapshot[], count = TOP_COUNT): EtfSnapshot[] {
  return etfs
    .filter((e) => isActiveTw(e.code) && e.holdings.reduce((a, h) => a + h.weight, 0) >= 50)
    .sort((a, b) => b.scale - a.scale)
    .slice(0, count)
}

// --- Official sites (the check) ------------------------------------------------

export interface OfficialHoldings {
  dataDate: string | null
  scale: number | null
  holdings: Holding[]
}

// 統一 (ezmoney.com.tw GetPCF).
export function parsePresident(json: unknown): OfficialHoldings {
  const j = json as {
    pcf?: { TranDate?: string; PCFCode?: string; Amount?: number }[]
    asset?: { AssetCode?: string; Details?: { DetailCode: string; DetailName: string; Share: number | string; NavRate: number | string }[] }[]
  }
  const stocks = (j.asset ?? []).find((a) => a.AssetCode === 'ST')?.Details ?? []
  const nav = (j.pcf ?? []).find((p) => p.PCFCode === 'NAV')?.Amount
  return {
    dataDate: isoDate(j.pcf?.[0]?.TranDate),
    scale: nav === undefined ? null : num(nav),
    holdings: stocksOnly(stocks.map((d) => ({ code: String(d.DetailCode).trim(), name: d.DetailName, shares: num(d.Share), weight: num(d.NavRate) }))),
  }
}

// 復華 (fhtrust.com.tw assets).
export function parseFuhhwa(json: unknown): OfficialHoldings {
  const r = (json as { result?: { dDate?: string; pcf_FundNav?: string; detail?: { ftype: string; stockid: string; stockname: string; qshare: string; prate_addaccint: string }[] }[] }).result?.[0]
  return {
    dataDate: isoDate(r?.dDate),
    scale: r?.pcf_FundNav ? num(r.pcf_FundNav) : null,
    holdings: stocksOnly((r?.detail ?? []).filter((d) => d.ftype === '股票').map((d) => ({ code: String(d.stockid).trim(), name: d.stockname, shares: num(d.qshare), weight: num(d.prate_addaccint) }))),
  }
}

export function unverified(note: string, officialDate: string | null = null): OfficialCheck {
  return { status: 'unverified', officialDate, diffs: [], note }
}

// Same day, same shares, weights within rounding.
export function verify(third: EtfSnapshot, official: OfficialHoldings): OfficialCheck {
  if (official.dataDate !== third.dataDate) return unverified(`官網資料日 ${official.dataDate ?? '不明'}，和第三方的 ${third.dataDate} 不同`, official.dataDate)
  if (official.holdings.length === 0) return unverified('官網沒有持股資料', official.dataDate)
  const mine = new Map(third.holdings.map((h) => [h.code, h]))
  const theirs = new Map(official.holdings.map((h) => [h.code, h]))
  const diffs: CheckDiff[] = []
  for (const code of new Set([...mine.keys(), ...theirs.keys()])) {
    const a = mine.get(code)
    const b = theirs.get(code)
    if (a && b && a.shares === b.shares && Math.abs(a.weight - b.weight) <= WEIGHT_TOLERANCE) continue
    diffs.push({ code, name: a?.name ?? b?.name ?? code, third: a ? { shares: a.shares, weight: a.weight } : null, official: b ? { shares: b.shares, weight: b.weight } : null })
  }
  const scaleNote = official.scale !== null && Math.abs(official.scale - third.scale) > Math.max(1, third.scale * 0.001) ? `；規模不同（官網 ${Math.round(official.scale / 1e8)} 億）` : ''
  return {
    status: diffs.length === 0 && !scaleNote ? 'match' : 'mismatch',
    officialDate: official.dataDate,
    diffs,
    note: diffs.length === 0 && !scaleNote ? `${third.holdings.length} 檔持股與官網一致` : `${diffs.length} 檔持股與官網不同${scaleNote}`,
  }
}

// --- History, changes, consensus ----------------------------------------------

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000

// New snapshots replace one of the same fund and day; 60 days are kept.
export function mergeHistory(prev: ActiveEtfFile['history'] | undefined, snapshots: EtfSnapshot[]): ActiveEtfFile['history'] {
  const out: ActiveEtfFile['history'] = {}
  for (const [code, list] of Object.entries(prev ?? {})) out[code] = [...list]
  for (const s of snapshots) out[s.code] = [...(out[s.code] ?? []).filter((x) => x.dataDate !== s.dataDate), s].sort((a, b) => a.dataDate.localeCompare(b.dataDate))
  const latest = Object.values(out).flat().reduce((m, s) => (s.dataDate > m ? s.dataDate : m), '')
  for (const code of Object.keys(out)) {
    out[code] = out[code].filter((s) => daysBetween(s.dataDate, latest) < KEEP_DAYS)
    if (out[code].length === 0) delete out[code]
  }
  return out
}

export const latestOf = (file: ActiveEtfFile, code: string) => file.history[code]?.at(-1)
export const previousOf = (file: ActiveEtfFile, code: string) => file.history[code]?.at(-2)

export type ChangeKind = 'new' | 'removed' | 'add' | 'cut'
export const CHANGE_LABELS: Record<ChangeKind, string> = { new: '新增', removed: '剔除', add: '加碼', cut: '減碼' }

export interface HoldingChange {
  code: string
  name: string
  kind: ChangeKind
  sharesDelta: number
  weight: number
  weightDelta: number
}

// Against the previous day's holdings, by shares.
export function changesOf(prev: EtfSnapshot | undefined, cur: EtfSnapshot | undefined): HoldingChange[] {
  if (!prev || !cur) return []
  const before = new Map(prev.holdings.map((h) => [h.code, h]))
  const now = new Map(cur.holdings.map((h) => [h.code, h]))
  const out: HoldingChange[] = []
  for (const h of cur.holdings) {
    const b = before.get(h.code)
    if (!b) out.push({ code: h.code, name: h.name, kind: 'new', sharesDelta: h.shares, weight: h.weight, weightDelta: h.weight })
    else if (h.shares !== b.shares) out.push({ code: h.code, name: h.name, kind: h.shares > b.shares ? 'add' : 'cut', sharesDelta: h.shares - b.shares, weight: h.weight, weightDelta: h.weight - b.weight })
  }
  for (const b of prev.holdings) if (!now.has(b.code)) out.push({ code: b.code, name: b.name, kind: 'removed', sharesDelta: -b.shares, weight: 0, weightDelta: -b.weight })
  const order: ChangeKind[] = ['new', 'add', 'cut', 'removed']
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || Math.abs(b.weightDelta) - Math.abs(a.weightDelta))
}

export interface StockPosition {
  etf: string
  weight: number
  shares: number
  change: HoldingChange | null
  dataDate: string
}

// Where one stock sits in each of the top funds, with today's move.
export function stockActivity(file: ActiveEtfFile, code: string): StockPosition[] {
  return file.top.flatMap((etf) => {
    const cur = latestOf(file, etf)
    const h = cur?.holdings.find((x) => x.code === code)
    const change = changesOf(previousOf(file, etf), cur).find((c) => c.code === code) ?? null
    if (!cur || (!h && !change)) return []
    return [{ etf, weight: h?.weight ?? 0, shares: h?.shares ?? 0, change, dataDate: cur.dataDate }]
  })
}

export interface ConsensusRow {
  code: string
  name: string
  totalWeight: number
  positions: StockPosition[]
  // Funds that bought more (or newly) on the latest day.
  adding: number
}

// Stocks every top fund holds: all adding first, then two or more, then
// by combined weight.
export function consensus(file: ActiveEtfFile): ConsensusRow[] {
  const snaps = file.top.map((c) => latestOf(file, c)).filter((s): s is EtfSnapshot => s !== undefined)
  if (snaps.length === 0) return []
  const rows = snaps[0].holdings
    .filter((h) => snaps.every((s) => s.holdings.some((x) => x.code === h.code)))
    .map((h) => {
      const positions = stockActivity(file, h.code)
      return {
        code: h.code,
        name: h.name,
        totalWeight: positions.reduce((a, p) => a + p.weight, 0),
        positions,
        adding: positions.filter((p) => p.change?.kind === 'add' || p.change?.kind === 'new').length,
      }
    })
  const tier = (r: ConsensusRow) => (r.adding >= snaps.length ? 2 : r.adding >= 2 ? 1 : 0)
  return rows.sort((a, b) => tier(b) - tier(a) || b.totalWeight - a.totalWeight)
}

// Shares held on each of the last n days (null when not held).
export function sharesTrend(file: ActiveEtfFile, etf: string, code: string, n = 20): (number | null)[] {
  return (file.history[etf] ?? []).slice(-n).map((s) => s.holdings.find((h) => h.code === code)?.shares ?? null)
}

export async function fetchActiveEtf(base: string = import.meta.env.BASE_URL): Promise<ActiveEtfFile | null> {
  try {
    const response = await fetch(`${base}${ACTIVE_ETF_PATH}`, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as ActiveEtfFile
  } catch {
    return null
  }
}
