// Checks that every published data file is as new as it should be
// (handbook 附錄 C §7) and writes public/data/health.json.
//
//   npx tsx scripts/data-health.mts          after the data jobs: re-runs the
//                                            script of anything late once,
//                                            then records the result
//   npx tsx scripts/data-health.mts --live   the watchdog: reads the live site,
//                                            writes nothing, and tells the
//                                            workflow whether to run the data
//                                            jobs again or to notify
import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { checkFreshness, REPAIR_SCRIPTS, STATUS_LABELS, trackHealth, watchdogDecision, type DataFiles, type HealthFile } from '../src/lib/data/freshness.ts'

const SITE = 'https://aceehsu7396.github.io/personal-wealth-management/data'
const DIR = 'public/data'
const FILES: Record<keyof DataFiles, string> = {
  macro: 'macro',
  stocks: 'stocks',
  indices: 'indices',
  valuation: 'valuation',
  events: 'events',
  funds: 'funds',
  brief: 'brief',
  dailyResearch: 'daily-research',
  activeEtf: 'active-etf',
}
const live = process.argv.includes('--live')
const log = (msg: string) => console.log(`[data-health] ${msg}`)

async function read(name: string): Promise<unknown> {
  try {
    if (live) {
      const r = await fetch(`${SITE}/${name}.json`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      return r.ok ? await r.json() : null
    }
    return existsSync(`${DIR}/${name}.json`) ? JSON.parse(readFileSync(`${DIR}/${name}.json`, 'utf8')) : null
  } catch {
    return null
  }
}

async function readAll(): Promise<DataFiles> {
  const out: Record<string, unknown> = {}
  for (const [key, name] of Object.entries(FILES)) out[key] = await read(name)
  return out as DataFiles
}

function summary(health: HealthFile): string {
  const bad = health.items.filter((i) => i.status !== 'ok')
  if (bad.length === 0) return `${health.items.length} 項都正常`
  return bad.map((i) => `${i.label}［${STATUS_LABELS[i.status]}］${i.note}${i.tried.length > 0 ? `（試過：${i.tried.join('、')}）` : ''}`).join('；')
}

const now = new Date()
const prev = (await read('health')) as HealthFile | null
let files = await readAll()

if (live) {
  const health = trackHealth(prev, checkFreshness(files, now), now, {}, files.macro?.generatedAt ?? null)
  const decision = watchdogDecision(health, now)
  log(summary(health))
  for (const r of decision.reasons) log(`・${r}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `dispatch=${decision.dispatch}\nnotify=${decision.notify}\n`)
    const stale = health.items.filter((i) => i.status === 'stale')
    const text = stale.map((i) => `- ${i.label}：${i.note}；最新資料 ${i.latest ?? '無'}；自 ${i.since?.slice(0, 16).replace('T', ' ')} 起修復中，試過 ${i.tried.join('、') || '重跑'}`).join('\n')
    appendFileSync(process.env.GITHUB_OUTPUT, `report<<EOF\n${text}\nEOF\n`)
  }
} else {
  // Repair: run the script of each late or missing item once more.
  const first = checkFreshness(files, now)
  const tried: Record<string, string[]> = {}
  const scripts = [...new Set(first.filter((i) => i.status === 'late' || i.status === 'missing').map((i) => REPAIR_SCRIPTS[i.key]).filter(Boolean))]
  for (const script of scripts) {
    log(`重跑 ${script}`)
    try {
      execSync(`npx tsx scripts/${script}.mts`, { stdio: 'inherit', timeout: 20 * 60_000 })
    } catch (e) {
      log(`${script} 失敗：${(e as Error).message.slice(0, 120)}`)
    }
    for (const i of first) if (REPAIR_SCRIPTS[i.key] === script && i.status !== 'ok' && i.status !== 'warn') (tried[i.key] ??= []).push(`重跑 ${script}`)
  }
  if (scripts.length > 0) files = await readAll()
  const health = trackHealth(prev, checkFreshness(files, now), now, tried, files.macro?.generatedAt ?? null)
  writeFileSync(`${DIR}/health.json`, JSON.stringify(health))
  log(`${DIR}/health.json：${summary(health)}`)
}
