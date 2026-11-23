import { closeDue } from '../paper/autoRoutine'

// Whether each published data file is as new as it should be (handbook
// 附錄 C §7): the data jobs keep going on errors, so a source that changes
// its page would otherwise freeze a file without anyone noticing. Checked
// after every data run (scripts/data-health.mts) and hourly by the
// watchdog workflow, which re-runs late data and notifies only when a
// repair has failed for hours.

export const HEALTH_PATH = 'data/health.json'

// ok: fine; warn: fresh, but a source reported errors; late: past its
// deadline, being repaired; stale: repairs failed for hours, notify.
export type HealthStatus = 'ok' | 'warn' | 'late' | 'stale' | 'missing'

export const STATUS_LABELS: Record<HealthStatus, string> = { ok: '正常', warn: '有警告', late: '修復中', stale: '需要處理', missing: '沒有資料' }

export interface HealthItem {
  key: string
  label: string
  latest: string | null
  status: HealthStatus
  note: string
}

export interface HealthEntry extends HealthItem {
  // When it first went late, and repairs tried since.
  since?: string
  attempts: number
  tried: string[]
}

export interface HealthFile {
  checkedAt: string
  // When the data jobs last ran (macro.json's time), to spot a missed run.
  dataAt: string | null
  items: HealthEntry[]
}

type Dated = { date: string }

// The published files, as far as the check reads them.
export interface DataFiles {
  macro?: {
    generatedAt: string
    errors: string[]
    series: Record<string, Dated[] | undefined>
    margin: { now: Dated } | null
    fubon: { reportDate: string }[]
    fubonLatestListed?: { date: string }
  } | null
  stocks?: { generatedAt: string; date: string; errors: string[] } | null
  indices?: { generatedAt: string; errors: string[]; series: Record<string, Dated[] | undefined> } | null
  valuation?: { points: Dated[] } | null
  events?: { generatedAt: string; errors: string[] } | null
  funds?: { generatedAt: string; errors: string[]; funds: [string, string, number, string, string][] } | null
  brief?: { date: string } | null
  dailyResearch?: { runs: Dated[] } | null
  activeEtf?: { generatedAt: string; sourceUpdated: string | null; top: string[]; history: Record<string, { dataDate: string }[]>; errors: string[] } | null
}

// How long each item may lag, and how long repairs may run before you are
// told (the active ETF source has no backup, so it gets a full day).
export const FRESHNESS_RULES = {
  taiexTradingDays: 1,
  usDays: 4,
  stocksTradingDays: 2,
  fredDailyDays: 7,
  monthlyDays: 95,
  marginTradingDays: 3,
  fubonDays: 45,
  fubonBehindListedDays: 20,
  valuationTradingDays: 3,
  activeEtfTradingDays: 3,
  activeEtfSourceDays: 4,
  dailyDays: 2,
  fundNavDays: 5,
  notifyAfterHours: 12,
  activeEtfNotifyAfterHours: 24,
} as const

const DAY_MS = 86400000
const TAIPEI_MS = 8 * 3600_000
export const taipeiToday = (now: Date) => new Date(now.getTime() + TAIPEI_MS).toISOString().slice(0, 10)
const days = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY_MS)

// Weekdays after `from` up to and including `to`.
export function tradingDaysBetween(from: string, to: string): number {
  let n = 0
  const d = new Date(`${from.slice(0, 10)}T00:00:00Z`)
  const end = to.slice(0, 10)
  while (d.toISOString().slice(0, 10) < end) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++
  }
  return n
}

function previousWeekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  do d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

const lastDate = (points: Dated[] | undefined) => points?.at(-1)?.date ?? null
const maxOf = (dates: (string | null | undefined)[]) => dates.filter((d): d is string => !!d).reduce<string | null>((m, d) => (m === null || d > m ? d : m), null)
const minOf = (dates: (string | null | undefined)[]) => dates.filter((d): d is string => !!d).reduce<string | null>((m, d) => (m === null || d < m ? d : m), null)
const errorNote = (errors: string[] | undefined) => (errors && errors.length > 0 ? `來源回報錯誤：${errors.slice(0, 2).join('；')}${errors.length > 2 ? ` 等 ${errors.length} 個` : ''}` : '')

export function checkFreshness(files: DataFiles, now: Date): HealthItem[] {
  const today = taipeiToday(now)
  const close = closeDue(now)
  const items: HealthItem[] = []
  const add = (key: string, label: string, latest: string | null, late: boolean, why: string, errors?: string[]) => {
    const err = errorNote(errors)
    const status: HealthStatus = latest === null ? 'missing' : late ? 'late' : err ? 'warn' : 'ok'
    items.push({ key, label, latest, status, note: latest === null ? '沒有資料' : late ? why : err })
  }
  const trading = (latest: string | null, allow: number) => latest !== null && tradingDaysBetween(latest, close) > allow
  const calendar = (latest: string | null, allow: number) => latest !== null && days(latest, today) > allow

  const taiex = lastDate(files.indices?.series.TAIEX)
  add('taiex', '每日大盤（加權指數）', taiex, trading(taiex, FRESHNESS_RULES.taiexTradingDays), `加權指數停在 ${taiex}，應有 ${close} 的收盤`, files.indices?.errors)
  const us = lastDate(files.indices?.series.GSPC)
  add('us', '美股指數', us, calendar(us, FRESHNESS_RULES.usDays), `S&P 500 停在 ${us}`)

  const stocks = files.stocks?.date ?? null
  add('stocks', '選股資料', stocks, trading(stocks, FRESHNESS_RULES.stocksTradingDays), `選股資料停在 ${stocks}`, files.stocks?.errors)

  const fred = lastDate(files.macro?.series.T10Y2Y)
  add('fred', '總經（每日數列）', fred, calendar(fred, FRESHNESS_RULES.fredDailyDays), `美國利差數列停在 ${fred}`, files.macro?.errors)
  const monthly = minOf([lastDate(files.macro?.series.CPIAUCSL), lastDate(files.macro?.series.TW_BUSINESS_SCORE)])
  add('monthly', '總經（每月數列）', monthly, calendar(monthly, FRESHNESS_RULES.monthlyDays), `每月數列最舊停在 ${monthly}`)
  const margin = files.macro?.margin?.now.date ?? null
  add('margin', '融資餘額', margin, trading(margin, FRESHNESS_RULES.marginTradingDays), `融資餘額停在 ${margin}`)

  const fubon = maxOf((files.macro?.fubon ?? []).map((f) => f.reportDate))
  const listed = files.macro?.fubonLatestListed?.date
  const behindListed = !!(fubon && listed && days(fubon, listed) > FRESHNESS_RULES.fubonBehindListedDays)
  add(
    'fubon',
    '富邦市場展望',
    fubon,
    behindListed || calendar(fubon, FRESHNESS_RULES.fubonDays),
    behindListed ? `網站已有 ${listed} 上架的新一期，只解析到 ${fubon}` : `最新一期是 ${fubon}，超過 ${FRESHNESS_RULES.fubonDays} 天沒有新一期`,
  )

  const valuation = lastDate(files.valuation?.points)
  add('valuation', '全市場本益比', valuation, trading(valuation, FRESHNESS_RULES.valuationTradingDays), `本益比歷史停在 ${valuation}`)

  const etf = files.activeEtf
  const etfDate = etf ? minOf(etf.top.map((c) => etf.history[c]?.at(-1)?.dataDate)) : null
  const sourceOld = !!(etf?.sourceUpdated && days(etf.sourceUpdated, today) > FRESHNESS_RULES.activeEtfSourceDays)
  add(
    'activeEtf',
    '主動式 ETF 持股',
    etfDate,
    trading(etfDate, FRESHNESS_RULES.activeEtfTradingDays) || sourceOld,
    sourceOld ? `第三方資料（active-etf）停在 ${etf?.sourceUpdated}` : `持股停在 ${etfDate}`,
    etf?.errors,
  )

  const events = files.events?.generatedAt.slice(0, 10) ?? null
  add('events', '事件日曆', events, calendar(events, FRESHNESS_RULES.dailyDays), `事件日曆 ${events} 之後沒有更新`, files.events?.errors)
  const nav = files.funds ? maxOf(files.funds.funds.map((f) => f[3])) : null
  add('funds', '基金淨值', nav, calendar(nav, FRESHNESS_RULES.fundNavDays), `基金淨值停在 ${nav}`, files.funds?.errors)
  const brief = files.brief?.date ?? null
  add('brief', '推播摘要', brief, calendar(brief, FRESHNESS_RULES.dailyDays), `推播摘要停在 ${brief}`)

  // A round each weekday, due by midday (the scheduled runs come late).
  const research = lastDate(files.dailyResearch?.runs)
  const hour = new Date(now.getTime() + TAIPEI_MS).getUTCHours()
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const researchDue = weekday >= 1 && weekday <= 5 && hour >= 13 ? today : previousWeekday(today)
  add('dailyResearch', '每日自動研究', research, research !== null && research < researchDue && tradingDaysBetween(research, researchDue) > 0, `最近一輪是 ${research}，應有 ${researchDue} 的這一輪`)

  return items
}

// What a data run repairs for each item: the script to run again.
export const REPAIR_SCRIPTS: Record<string, string> = {
  taiex: 'index-data',
  us: 'index-data',
  stocks: 'stocks-data',
  fred: 'macro-data',
  monthly: 'macro-data',
  margin: 'macro-data',
  fubon: 'macro-data',
  valuation: 'valuation-data',
  activeEtf: 'active-etf',
  events: 'events-data',
  funds: 'fund-nav',
  brief: 'brief-data',
}

const notifyAfter = (key: string) => (key === 'activeEtf' ? FRESHNESS_RULES.activeEtfNotifyAfterHours : FRESHNESS_RULES.notifyAfterHours) * 3600_000

// This check on top of the last one: how long each item has been late and
// what was tried, and late for too long becomes stale.
export function trackHealth(prev: HealthFile | null, items: HealthItem[], now: Date, tried: Record<string, string[]> = {}, dataAt: string | null = null): HealthFile {
  const entries = items.map((item): HealthEntry => {
    const before = prev?.items.find((x) => x.key === item.key)
    if (item.status !== 'late' && item.status !== 'missing') return { ...item, attempts: 0, tried: [] }
    const since = before?.since ?? now.toISOString()
    const these = tried[item.key] ?? []
    const entry: HealthEntry = {
      ...item,
      since,
      attempts: (before?.attempts ?? 0) + (these.length > 0 ? 1 : 0),
      tried: [...new Set([...(before?.tried ?? []), ...these])],
    }
    if (now.getTime() - Date.parse(since) >= notifyAfter(item.key)) entry.status = 'stale'
    return entry
  })
  return { checkedAt: now.toISOString(), dataAt, items: entries }
}

// The watchdog's decisions on the live site.
export function watchdogDecision(health: HealthFile, now: Date): { dispatch: boolean; notify: boolean; reasons: string[] } {
  const reasons: string[] = []
  const pending = health.items.filter((i) => i.status === 'late' || i.status === 'missing' || i.status === 'stale')
  for (const i of pending) reasons.push(`${i.label}：${i.note}`)
  // A trading day's close is out (14:30) but the data jobs have not run since.
  const close = closeDue(now)
  const closeAt = Date.parse(`${close}T06:30:00Z`)
  const missedRun = taipeiToday(now) === close && (!health.dataAt || Date.parse(health.dataAt) < closeAt)
  if (missedRun) reasons.push(`${close} 收盤後還沒有更新過資料`)
  const stale = health.items.filter((i) => i.status === 'stale')
  // Once a day (the 09:00 check) while it lasts, and when it first turns stale.
  const hour = new Date(now.getTime() + TAIPEI_MS).getUTCHours()
  const fresh = stale.some((i) => i.since && now.getTime() - Date.parse(i.since) - notifyAfter(i.key) < 3600_000)
  return { dispatch: pending.length > 0 || missedRun, notify: stale.length > 0 && (hour === 9 || fresh), reasons }
}

export async function fetchHealth(base: string = import.meta.env.BASE_URL): Promise<HealthFile | null> {
  try {
    const response = await fetch(`${base}${HEALTH_PATH}`, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as HealthFile
  } catch {
    return null
  }
}
