import { useAppStore } from '../storage/appStore'
import { useJourney } from '../useJourney'
import { useSignals } from '../research/useSignals'
import { evaluateThesis } from '../calculations/thesisScoring'
import { addMonths, computeDiscipline } from '../calculations/disciplineScore'
import { ACTION_LABELS, EXIT_ALERT_ACTIONS, buyDistanceOf } from '../research/signals'
import { todayIsoDate } from '../market/twse'
import { useRegime } from '../market/useRegime'
import { allows } from '../market/regime'
import { dipLadderStatus } from '../market/dipLadder'
import { fullTimeTarget } from '../calculations/traderReadiness'
import { ENTRY_METHOD_LABELS, positionScanItems, scanItem, sortScan, type ScanItem } from './tradePlan'
import { useOpenPlanStatus } from './useOpenPlanStatus'

// Research cards should be refreshed after every quarterly report.
const THESIS_STALE_MONTHS = 4

// The day's work in discipline order (blueprint 02 §3.1 ①): open positions
// first (stops, broken theses, targets, time stops, stops to raise), then
// buy points, then reviews and housekeeping.
export function useDailyScan(): { items: ScanItem[]; loading: boolean } {
  const theses = useAppStore((s) => s.stockTheses)
  const plans = useAppStore((s) => s.tradePlans)
  const trades = useAppStore((s) => s.trades)
  const holdings = useAppStore((s) => s.holdings)
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const ladder = useAppStore((s) => s.dipLadder)
  const assumptions = useAppStore((s) => s.assumptions)
  const foundation = useAppStore((s) => s.foundation)
  const regime = useRegime()
  const { policy, journey } = useJourney()
  const signalsFor = useSignals()
  const { items: open, loading } = useOpenPlanStatus()
  const today = todayIsoDate()

  const items: ScanItem[] = []
  for (const { plan, status } of open) if (status) items.push(...positionScanItems(plan, status))

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
      items.push(scanItem('regime_exit', `${plan.ticker} ${plan.name}：局勢為「${ctx.label}」，建議依部位倍數 ${ctx.multiplier} 縮小部位`, '出場規則：局勢出場（01 §C4）', `/portfolio/plans?id=${plan.id}`))
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
  const stale = theses.filter((t) => t.status !== 'exited' && addMonths(t.updatedAt.slice(0, 10), THESIS_STALE_MONTHS) <= today)
  if (stale.length > 0) {
    const names = stale.slice(0, 3).map((t) => t.ticker).join('、') + (stale.length > 3 ? '…' : '')
    items.push(scanItem('housekeeping', `${stale.length} 張研究卡超過 ${THESIS_STALE_MONTHS} 個月未更新（${names}）`, '手冊 07：每季財報後更新', '/research/stocks'))
  }
  return { items: sortScan(items), loading: loading || regime.loading }
}
