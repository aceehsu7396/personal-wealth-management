import type { Bar } from '../market/priceHistory'
import type { Cadence, StrategyTemplate } from '../storage/schema'

// Weekly decisions on daily data (handbook 10 §6.6): entries and exits are
// decided once a week at the close of the decision day, and fill at the
// next session's open; stops still trigger on any day. Each week runs up
// to and including the decision day, so with Wednesday as the decision
// day, Thursday and Friday belong to the next week. When the decision day
// is a holiday, the last session before it decides.

export const DEFAULT_DECISION_DAY = 5

export const WEEKDAY_LABELS: Record<number, string> = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' }

export const WEEKLY_TEMPLATES: StrategyTemplate[] = ['weekly_ma', 'weekly_breakout', 'weekly_rotation', 'weekly_pullback']

// Templates whose daily rules can also be decided weekly.
export const CADENCE_TEMPLATES: StrategyTemplate[] = ['ma_cross', 'donchian', 'rsi_reversion', 'momentum_rotation', 'chip_flow']

export const isWeeklyTemplate = (t: StrategyTemplate) => WEEKLY_TEMPLATES.includes(t)

// The weekly templates are always weekly; the others as set (default daily).
export function cadenceOf(template: StrategyTemplate, cadence?: Cadence): Cadence {
  if (isWeeklyTemplate(template)) return 'weekly'
  return CADENCE_TEMPLATES.includes(template) ? (cadence ?? 'daily') : 'daily'
}

const DAY_MS = 86400000
const weekday = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()
const addDays = (date: string, n: number) => new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

// The decision date of the week a date belongs to; it also names the week.
export function decisionDateOf(date: string, day: number): string {
  const w = weekday(date)
  return addDays(date, w <= day ? day - w : 7 - w + day)
}

// Is this bar the last one of its week? With the next bar known (a
// backtest), the next bar starting a new week settles it. For the latest
// bar, the week is over once the bar is on the decision day, or `today`
// has passed the decision day (a holiday).
export function isDecisionBar(date: string, nextDate: string | undefined, day: number, today?: string): boolean {
  const end = decisionDateOf(date, day)
  if (nextDate !== undefined) return decisionDateOf(nextDate, day) !== end
  return date.slice(0, 10) === end || (today !== undefined && today.slice(0, 10) > end)
}

// 「每日」 or 「每週五」 for a card (its own day, else the site-wide one).
export function cadenceLabel(card: { template: StrategyTemplate; cadence?: Cadence; decisionDay?: number }, globalDay = DEFAULT_DECISION_DAY): string {
  if (cadenceOf(card.template, card.cadence) !== 'weekly') return '每日'
  return `每${WEEKDAY_LABELS[card.decisionDay ?? globalDay]}`
}

// The latest decision date on or before today.
export function lastDecisionDate(today: string, day: number): string {
  const next = decisionDateOf(today, day)
  return next === today.slice(0, 10) ? next : addDays(next, -7)
}

export interface WeeklySeries {
  // One bar per week: first open, the week's high and low, the latest
  // close; date = the latest daily bar's date. The last week may still be
  // in progress (its last daily bar is not a decision bar).
  bars: Bar[]
  // For each daily bar: its week's index, and whether it closes the week.
  weekOf: number[]
  decision: boolean[]
}

// Weekly bars from daily ones.
export function weeklyBars(daily: Bar[], day: number, today?: string): WeeklySeries {
  const bars: Bar[] = []
  const weekOf: number[] = []
  const decision: boolean[] = []
  let from = 0
  const close = (to: number) => {
    const week = daily.slice(from, to + 1)
    bars.push({
      date: daily[to].date,
      open: week[0].open,
      high: Math.max(...week.map((b) => b.high)),
      low: Math.min(...week.map((b) => b.low)),
      close: daily[to].close,
      volume: week.reduce((a, b) => a + b.volume, 0),
    })
    from = to + 1
  }
  for (let i = 0; i < daily.length; i++) {
    const ends = isDecisionBar(daily[i].date, daily[i + 1]?.date, day, today)
    weekOf.push(bars.length)
    decision.push(ends)
    if (ends) close(i)
  }
  if (from < daily.length) close(daily.length - 1)
  return { bars, weekOf, decision }
}
