import { useAppStore } from '../storage/appStore'
import { useJourney } from '../useJourney'
import { useSignals } from '../research/useSignals'
import { evaluateThesis } from '../calculations/thesisScoring'
import { addMonths, computeDiscipline } from '../calculations/disciplineScore'
import { ACTION_LABELS, EXIT_ALERT_ACTIONS, buyDistanceOf } from '../research/signals'
import { todayIsoDate } from '../market/twse'
import { useRegime } from '../market/useRegime'
import { EVENT_RULES, GAP_RISK, upcoming, useEvents } from '../market/events'
import { allows } from '../market/regime'
import { dipLadderStatus } from '../market/dipLadder'
import { fullTimeTarget } from '../calculations/traderReadiness'
import { ENTRY_METHOD_LABELS, positionScanItems, scanItem, sortScan, type ScanItem } from './tradePlan'
import { useOpenPlanStatus } from './useOpenPlanStatus'
import { usePauseStatus } from './usePauseStatus'
import { useEntrySignals } from './useEntrySignals'
import { nextBatch } from './batches'
import { ENTRY_SIGNAL_LABELS, ENTRY_SIGNAL_METHOD } from './entrySignals'

// Research cards should be refreshed after every quarterly report.
const THESIS_STALE_MONTHS = 4

// The day's work in discipline order (handbook 04 §0): open positions
// first (stops, broken theses, targets, time stops, stops to raise), then
// buy points, then reviews and housekeeping.
export function useDailyScan(): { items: ScanItem[]; loading: boolean } {
  const theses = useAppStore((s) => s.stockTheses)
  const plans = useAppStore((s) => s.tradePlans)
  const trades = useAppStore((s) => s.trades)
  const holdings = useAppStore((s) => s.holdings)
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const ladder = useAppStore((s) => s.dipLadder)
  const decisions = useAppStore((s) => s.decisions)
  const scenarioSets = useAppStore((s) => s.scenarioSets)
  const assumptions = useAppStore((s) => s.assumptions)
  const foundation = useAppStore((s) => s.foundation)
  const regime = useRegime()
  const pause = usePauseStatus()
  const events = useEvents(todayIsoDate())
  const entry = useEntrySignals()
  const { policy, journey } = useJourney()
  const signalsFor = useSignals()
  const { items: open, loading } = useOpenPlanStatus()
  const today = todayIsoDate()

  const items: ScanItem[] = []
  for (const { plan, status } of open) if (status) items.push(...positionScanItems(plan, status))

  // The next planned batch at its price: lower for value batches, higher
  // for an add-on bought on strength.
  for (const { plan, status } of open) {
    const i = nextBatch(plan.batches)
    if (!status || i < 0) continue
    const b = plan.batches[i]
    const reached = b.kind === 'add' ? status.close >= b.price : status.close <= b.price
    if (!reached) continue
    const note = regime.ctx && regime.ctx.row.addOn === 'none' ? `；目前局勢「${regime.ctx.label}」不加碼` : ''
    items.push(scanItem('buy_zone', `${plan.ticker} ${plan.name}：第 ${i + 1} 批到價（${b.price}，收盤 ${status.close}），${b.shares} 股`, `計畫單：分批與加碼${note}`, `/portfolio/plans?id=${plan.id}`))
  }

  // Pause rules come before any new risk (handbook 04 §8).
  if (pause.streakPaused) {
    items.push(scanItem('pause', `連續虧損 ${pause.streak} 筆：交易部位暫停新建倉，先完成暫停檢討`, `投資政策：連續虧損 ${pause.streakLimit} 筆就暫停`, '/portfolio/risk'))
  }
  if (pause.monthPaused) {
    items.push(scanItem('pause', `本月已實現虧損 ${pause.monthPercent.toFixed(1)}%：本月暫停新建倉`, `投資政策：單月虧損上限 ${pause.monthLimit}%`, '/portfolio/risk'))
  }

  // Regime: a change, and open trades the new regime no longer allows.
  const ctx = regime.ctx
  if (ctx?.changedRecently) {
    const rule =
      ctx.multiplier > 0 && ctx.row.allowedEntries.length > 0
        ? `新計畫單部位倍數 ${ctx.multiplier}，只允許${ctx.row.allowedEntries.map((m) => ENTRY_METHOD_LABELS[m]).join('、')}`
        : '暫停新建倉'
    items.push(scanItem('regime_change', `局勢轉為「${ctx.label}」（${ctx.since} 起）：${rule}`, '局勢狀態：確認期 3 個交易日', '/research/market'))
  }
  if (ctx && (ctx.regime === 'bear' || ctx.regime === 'crash')) {
    for (const { plan } of open) {
      if (allows(ctx, plan.entryMethod)) continue
      items.push(scanItem('regime_exit', `${plan.ticker} ${plan.name}：局勢為「${ctx.label}」，建議依部位倍數 ${ctx.multiplier} 縮小部位`, '出場規則：局勢出場（05 §7）', `/portfolio/plans?id=${plan.id}`))
    }
  }
  const target = fullTimeTarget(assumptions, foundation)
  const dip = dipLadderStatus(ladder, regime.drawdown, regime.lastHigh, { amount: foundation.emergencyFundAmount, target: target.bufferTarget })
  if (dip.due) {
    const amount = `NT$${dip.due.amountTwd.toLocaleString('zh-TW')}`
    items.push(
      dip.bufferShort
        ? scanItem('dip_ladder', `加權指數距高點 ${regime.drawdown}%：逢低階梯要投入 ${amount}，但生活費緩衝不足，先補緩衝`, '逢低階梯；生活費緩衝優先', '/goals', 'required')
        : scanItem('dip_ladder', `加權指數距高點 ${regime.drawdown}%：依逢低階梯投入 ${amount}（${dip.due.drawdownPercent}% 這一階）`, '逢低階梯（已簽署）', '/goals'),
    )
  }

  const advised = theses
    .filter((t) => t.auto && t.status !== 'exited')
    .map((t) => ({ thesis: t, report: signalsFor(t, evaluateThesis(t, policy)) }))
  const card = (ticker: string) => `/research/stocks?new=${encodeURIComponent(ticker)}`
  for (const { thesis, report } of advised) {
    const name = `${thesis.ticker} ${thesis.name}`
    if (report.held && EXIT_ALERT_ACTIONS.includes(report.action)) {
      items.push(scanItem('thesis_exit', `${name}：研究卡建議${ACTION_LABELS[report.action]}`, `研究卡：${report.headline}`, card(thesis.ticker)))
    } else if (buyDistanceOf(report, thesis.kind === 'etf').inZone) {
      const draft = plans.find((p) => p.status === 'draft' && p.thesisId === thesis.id)
      items.push(
        scanItem(
          'buy_zone',
          `${name}：${ACTION_LABELS[report.action]}${draft ? '，打開草稿計畫單' : '，先建立計畫單'}`,
          `研究卡：${report.headline}`,
          draft ? `/portfolio/plans?id=${draft.id}` : `/portfolio/plans?thesis=${encodeURIComponent(thesis.id)}`,
        ),
      )
    }
  }

  // Entry conditions on watched symbols: a nudge to draft a plan.
  for (const w of entry.items) {
    for (const sig of w.signals) {
      const method = ENTRY_SIGNAL_METHOD[sig.kind]
      const q = `method=${method}`
      const to = w.thesisId ? `/portfolio/plans?thesis=${encodeURIComponent(w.thesisId)}&${q}` : w.strategyId ? `/portfolio/plans?strategy=${encodeURIComponent(w.strategyId)}&${q}` : `/portfolio/plans?ticker=${encodeURIComponent(w.ticker)}&market=${w.market}&${q}`
      const blocked = regime.ctx && !allows(regime.ctx, method) ? `；目前局勢「${regime.ctx.label}」不允許${ENTRY_METHOD_LABELS[method]}進場` : ''
      items.push(scanItem('entry_signal', `${w.ticker} ${w.name}：${ENTRY_SIGNAL_LABELS[sig.kind]}（${sig.detail}）：建立計畫單`, `進場條件監控（${sig.date}）${blocked}`, to))
    }
  }

  const discipline = computeDiscipline(trades, holdings, theses, policy, today)
  if (discipline.pendingReviews.length > 0) {
    items.push(scanItem('review_due', `${discipline.pendingReviews.length} 筆交易待完成事後檢討`, '紀律：每筆交易 6 與 12 個月後檢討', '/portfolio/trades'))
  }
  const latestMacro = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))[0]
  // Macro reviews belong to stage three; only nag once the core is in place
  // or the habit has started.
  const macroStageReached = journey.stages[1].done || latestMacro !== undefined
  if (macroStageReached && (!latestMacro || addMonths(latestMacro.date, 1) <= today)) {
    items.push(scanItem('housekeeping', '本月的總經三支柱檢視尚未完成', '手冊 05：每月檢視一次', '/research/market'))
  }
  // Events for what is held or planned, within three trading days.
  const watched = new Set([...holdings.filter((h) => h.shares > 0).map((h) => h.ticker), ...plans.filter((p) => p.status === 'open').map((p) => p.ticker)])
  for (const e of upcoming(events, today, EVENT_RULES.soonSessions, watched, false)) {
    const gap = GAP_RISK.includes(e.kind) ? '；可能跳空，確認停損' : ''
    items.push(scanItem('event', `${e.ticker} ${e.name ?? ''}：${e.date.slice(5).replace('-', '/')} ${e.title}${gap}`, `事件日曆（${e.source}）`, '/research/market'))
  }
  const dueDecisions = decisions.filter((d) => !d.reviewedAt && d.reviewDate <= today)
  if (dueDecisions.length > 0) {
    items.push(scanItem('review_due', `${dueDecisions.length} 筆決策到了檢討日，回填結果`, '決策日誌：事前寫下、事後對答案', '/portfolio/calibration?tab=decisions'))
  }
  const dueSets = scenarioSets.filter((s) => s.outcome === undefined && s.horizon <= today)
  if (dueSets.length > 0) {
    items.push(scanItem('review_due', `${dueSets.length} 組情境推演已到期，標記實際發生的情境`, '機率校準：到期才能計分', '/portfolio/calibration?tab=scenarios'))
  }
  const stale = theses.filter((t) => t.status !== 'exited' && addMonths(t.updatedAt.slice(0, 10), THESIS_STALE_MONTHS) <= today)
  if (stale.length > 0) {
    const names = stale.slice(0, 3).map((t) => t.ticker).join('、') + (stale.length > 3 ? '…' : '')
    items.push(scanItem('housekeeping', `${stale.length} 張研究卡超過 ${THESIS_STALE_MONTHS} 個月未更新（${names}）`, '手冊 07：每季財報後更新', '/research/stocks'))
  }
  return { items: sortScan(items), loading: loading || regime.loading || entry.loading }
}
