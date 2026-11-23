// 更新收盤價並產生建議 without pressing it (handbook 10 §7): the paper
// accounts live in this browser, so no server can run them; instead the
// site runs the routine itself once per trading day's close, when it is
// opened (or left open) after the close is published.

// TWSE publishes the day's bars after the 13:30 close; 14:30 is safe.
export const CLOSE_READY = { hour: 14, minute: 30 }
// How often an open page checks whether the close is in.
export const CHECK_EVERY_MS = 5 * 60 * 1000

const TAIPEI_MS = 8 * 3600_000

const taipei = (now: Date) => new Date(now.getTime() + TAIPEI_MS)
const isoOf = (d: Date) => d.toISOString().slice(0, 10)

// The latest trading day whose close should be in by now (Taiwan time):
// today from 14:30 on a weekday, otherwise the weekday before. Holidays
// count as trading days here; the fetch then returns the last real close.
export function closeDue(now: Date): string {
  const t = taipei(now)
  const weekday = t.getUTCDay()
  const ready = t.getUTCHours() > CLOSE_READY.hour || (t.getUTCHours() === CLOSE_READY.hour && t.getUTCMinutes() >= CLOSE_READY.minute)
  if (weekday >= 1 && weekday <= 5 && ready) return isoOf(t)
  const d = new Date(t)
  do d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return isoOf(d)
}

// The Taiwan date of a run's timestamp.
export const taipeiDate = (iso: string) => isoOf(taipei(new Date(iso)))

// Due when no run has happened since that close was published.
export function routineDue(now: Date, ranAt: string | undefined): boolean {
  if (!ranAt) return true
  const due = closeDue(now)
  const ran = taipei(new Date(ranAt))
  const ranDate = isoOf(ran)
  if (ranDate > due) return false
  if (ranDate < due) return true
  // Same day: only a run after the close counts.
  return ran.getUTCHours() < CLOSE_READY.hour || (ran.getUTCHours() === CLOSE_READY.hour && ran.getUTCMinutes() < CLOSE_READY.minute)
}

// One routine at a time across the page: the automatic run and the buttons.
let running = false
export const routineRunning = () => running
export function claimRoutine(): boolean {
  if (running) return false
  running = true
  return true
}
export function releaseRoutine(): void {
  running = false
}
