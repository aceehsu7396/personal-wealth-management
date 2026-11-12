// Builds public/data/brief.json: the market-wide part of the daily push
// notification (regime and whether it just changed, market-wide events in
// the next three trading days). The personal part is counted on the device
// by the service worker; nothing personal is in this file.
//
//   npx tsx scripts/brief-data.mts
import { readFileSync, writeFileSync } from 'node:fs'
import { REGIME_LABELS, REGIME_RULES, regimeHistory } from '../src/lib/market/regime.ts'
import { addDays, ruleEvents, sessionsBetween } from '../src/lib/market/events.ts'
import type { IndicesData } from '../src/lib/market/indices.ts'

const OUT = 'public/data/brief.json'
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

const indices = JSON.parse(readFileSync('public/data/indices.json', 'utf8')) as IndicesData
const taiex = indices.series.TAIEX ?? []
const history = regimeHistory(taiex, indices.series.VIX ?? [])
const seg = history.segments.at(-1)
const recentFrom = history.dates[Math.max(0, history.dates.length - REGIME_RULES.recentSessions)]
const regime = seg ? { label: REGIME_LABELS[seg.regime], since: seg.start, changed: history.segments.length > 1 && seg.confirmedOn >= recentFrom } : null
const events = ruleEvents(today, addDays(today, 7))
  .filter((e) => sessionsBetween(today, e.date) <= 3 && e.kind !== 'revenue')
  .map((e) => ({ date: e.date, title: e.title }))

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), date: today, regime, events }))
console.log(`[brief-data] ${OUT}：${regime ? `${regime.label}（${regime.since} 起）` : '沒有局勢'}、事件 ${events.length} 筆`)
