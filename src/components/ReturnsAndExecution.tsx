import { useAppStore } from '../lib/storage/appStore'
import { weightedReturns } from '../lib/calculations/attribution'
import { adviceUptake, closedResults, groupR, MIN_GROUP, regimeOfPlan, type RGroup } from '../lib/trades/rStats'
import { ENTRY_METHOD_LABELS, executionStats } from '../lib/trades/tradePlan'
import { Term } from './Term'
import { ADVICE_LABELS, Card, DataTable, StatTile } from './ui'
import { coachPrompt } from '../lib/ai/prompts/agents'
import { PromptPanel } from './ai/PromptPanel'

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`)
const r2 = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`)

function RTable({ rows, title }: { rows: RGroup[]; title: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <div className="mt-1">
        <DataTable<RGroup>
          rows={rows}
          rowKey={(g) => g.key}
          empty="還沒有已結束的計畫單。"
          columns={[
            { key: 'key', label: '分組', render: (g) => g.key },
            { key: 'n', label: '筆數', numeric: true, render: (g) => g.count, sortValue: (g) => g.count },
            { key: 'win', label: '勝率', numeric: true, render: (g) => pct(g.winRate, 0), sortValue: (g) => g.winRate },
            { key: 'r', label: '期望值', numeric: true, render: (g) => r2(g.expectancy), sortValue: (g) => g.expectancy },
            { key: 'note', label: '', render: (g) => (g.enough ? '' : <span className="text-xs text-gray-600 dark:text-gray-400">樣本太少</span>) },
          ]}
        />
      </div>
    </div>
  )
}

// Time- and money-weighted returns, R by entry method and regime, and
// whether following the assistant paid (handbook 08 §6.3, 04 §4).
export function ReturnsAndExecution() {
  const reviews = useAppStore((s) => s.performanceReviews)
  const pauseReviews = useAppStore((s) => s.pauseReviews)
  const plans = useAppStore((s) => s.tradePlans)
  const trades = useAppStore((s) => s.trades)
  const w = weightedReturns(reviews)
  const results = closedResults(plans, trades)
  const uptake = adviceUptake(plans, results)
  const exec = executionStats(plans, trades)
  const gap = w?.twrAnnual != null && w.mwrAnnual != null ? w.mwrAnnual - w.twrAnnual : null

  return (
    <div className="mt-8 space-y-6">
      <Card title="報酬：時間加權與金額加權" description="時間加權看投資方法本身；金額加權（XIRR）看你實際投入的錢賺多少。金額加權明顯較低，代表加碼的時機不好。">
        {w ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label={<><Term name="時間加權報酬">時間加權</Term>（年化）</>} value={pct(w.twrAnnual)} hint={`${w.from} 至 ${w.to}，累計 ${pct(w.twr)}`} />
            <StatTile label={<><Term name="金額加權報酬">金額加權</Term>（年化）</>} value={pct(w.mwrAnnual)} hint="依季度淨投入計算" />
            <StatTile label="兩者差距" value={gap === null ? '—' : Math.abs(gap) < 0.0005 ? '0.0 個百分點' : `${gap > 0 ? '+' : ''}${(gap * 100).toFixed(1)} 個百分點`} hint={gap === null ? '期間不足半年' : gap < -0.02 ? '加碼時機不好' : '投入時機沒有明顯拖累'} />
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">先在上方記錄季度績效檢討。</p>
        )}
      </Card>

      <Card title="R 倍數統計" description={`已結束的計畫單：R =（平均出場價 − 成交價）÷（成交價 − 初始停損）。少於 ${MIN_GROUP} 筆的分組先不下結論。`}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RTable title="依進場方法" rows={groupR(results, (p) => ENTRY_METHOD_LABELS[p.entryMethod])} />
          <RTable title="依建立時的局勢" rows={groupR(results, regimeOfPlan)} />
        </div>
      </Card>

      <Card title="執行品質" description="照計畫執行的程度，以及採納助手建議的結果。">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-600 dark:text-gray-400">有計畫單的買進</dt>
            <dd className="font-medium text-gray-900 dark:text-gray-100">
              {exec.planned}／{exec.satelliteBuys} 筆
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600 dark:text-gray-400">平均<Term name="滑價" /></dt>
            <dd className="font-medium text-gray-900 dark:text-gray-100">{pct(exec.avgSlippage, 2)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600 dark:text-gray-400"><Term name="停損延遲" /></dt>
            <dd className="font-medium text-gray-900 dark:text-gray-100">{exec.lateStops} 次</dd>
          </div>
          {(['required', 'suggest', 'notice'] as const).map((l) => (
            <div key={l}>
              <dt className="text-xs text-gray-600 dark:text-gray-400">{ADVICE_LABELS[l]}採納率</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">
                {uptake.byLevel[l].decided ? `${pct(uptake.byLevel[l].accepted / uptake.byLevel[l].decided, 0)}（${uptake.byLevel[l].decided} 條）` : '—'}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">
          紀律要求全部採納的計畫單平均 {r2(uptake.followedR)}（{uptake.followedCount} 筆）；有不採納的平均 {r2(uptake.declinedR)}（{uptake.declinedCount} 筆）。
        </p>
        <div className="mt-3">
          <PromptPanel
            label="AI 交易教練"
            build={() =>
              coachPrompt({
                groups: [
                  ...groupR(results, (p) => ENTRY_METHOD_LABELS[p.entryMethod]).map((g) => ({ ...g, by: '進場方法' })),
                  ...groupR(results, regimeOfPlan).map((g) => ({ ...g, by: '局勢' })),
                ],
                execution: [
                  `有計畫單的買進 ${exec.planned}／${exec.satelliteBuys} 筆`,
                  `平均滑價 ${pct(exec.avgSlippage, 2)}`,
                  `停損延遲 ${exec.lateStops} 次`,
                  ...(['required', 'suggest', 'notice'] as const).map((l) => `${ADVICE_LABELS[l]}採納率：${uptake.byLevel[l].decided ? pct(uptake.byLevel[l].accepted / uptake.byLevel[l].decided, 0) : '—'}（${uptake.byLevel[l].decided} 條）`),
                  `紀律要求全部採納的平均 ${r2(uptake.followedR)}（${uptake.followedCount} 筆）；有不採納的 ${r2(uptake.declinedR)}（${uptake.declinedCount} 筆）`,
                ],
                pauses: pauseReviews.map((r) => `${r.date} 連續 ${r.streak} 筆暫停並檢討：${r.notes}`),
              })
            }
          />
        </div>
      </Card>
    </div>
  )
}
