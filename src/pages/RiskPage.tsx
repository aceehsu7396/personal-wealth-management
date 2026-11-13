import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAppStore } from '../lib/storage/appStore'
import { useRiskReport, type PositionRisk } from '../lib/useRiskReport'
import { usePauseStatus } from '../lib/trades/usePauseStatus'
import type { StressScenario } from '../lib/calculations/stressTest'
import { StressCard } from '../components/risk/StressCard'
import { PauseReviewForm } from '../components/risk/PauseReviewForm'
import { Term } from '../components/Term'
import { AdviceList, Badge, Card, DataTable, Disclosure, PageHeader, StatTile, primaryButton, type Advice } from '../components/ui'

const twd = (v: number) => `${v < 0 ? '−' : ''}NT$${Math.round(Math.abs(v)).toLocaleString('zh-TW')}`
const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`)
const SOURCE_LABEL = { history: '一年日線', proxy: '以指數代替', none: '視為不波動' } as const

function DrawdownChart() {
  const snapshots = useAppStore((s) => s.portfolioSnapshots)
  let high = 0
  const data = [...snapshots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      high = Math.max(high, s.valueTwd)
      return { month: s.month, drawdown: high > 0 ? Math.round((s.valueTwd / high - 1) * 1000) / 10 : 0 }
    })
  if (data.length < 3) return <p className="text-sm text-gray-600 dark:text-gray-400">每月市值紀錄少於 3 筆，還畫不出回撤曲線。</p>
  return (
    <figure>
      <figcaption className="text-sm font-medium text-gray-900 dark:text-gray-100">組合回撤（每月，距前高 %）</figcaption>
      <div className="mt-2 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#9ca3af" strokeOpacity={0.25} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} minTickGap={24} />
            <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} width={40} tickFormatter={(v) => `${v}%`} domain={['dataMin', 0]} />
            <Tooltip formatter={(v) => [`${v}%`, '回撤']} />
            <Area type="linear" dataKey="drawdown" stroke="#dc2626" strokeWidth={2} fill="#dc2626" fillOpacity={0.12} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

// Risk (blueprint 02 §5): how much the portfolio could lose, where the risk
// sits, how long the buffer lasts, and the trading sleeve's pause rules.
export function RiskPage() {
  const [custom, setCustom] = useState<StressScenario | null>(null)
  const r = useRiskReport(custom)
  const pause = usePauseStatus()
  const reviews = useAppStore((s) => s.pauseReviews)
  const policy = r.policy

  const pauseItems: Advice[] = [
    ...(pause.streakPaused ? [{ level: 'required' as const, text: `連續虧損 ${pause.streak} 筆：交易部位暫停新建倉，完成下方的暫停檢討後解除`, basis: `投資政策：連續虧損 ${pause.streakLimit} 筆就暫停` }] : []),
    ...(pause.monthPaused ? [{ level: 'required' as const, text: `本月已實現虧損 ${pause.monthPercent.toFixed(1)}%：本月暫停新建倉，下個月自動解除`, basis: `投資政策：單月虧損上限 ${pause.monthLimit}%（Elder 6% 規則）` }] : []),
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="風險"
        summary="最壞會虧多少、風險集中在哪幾檔、生活費緩衝撐多久；以及交易部位的暫停規則。數字用近一年日線與今天的持股計算。"
        action={
          pause.streakPaused ? (
            <button type="button" className={primaryButton} onClick={() => document.getElementById('pause-review')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              寫暫停檢討
            </button>
          ) : undefined
        }
      />

      {pauseItems.length > 0 && (
        <div className="mt-6">
          <AdviceList items={pauseItems} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={<><Term name="CVaR">1 個月 CVaR</Term>（95%）</>}
          value={r.monthly ? `${twd(-r.monthly.cvar * r.total)}` : r.loading ? '計算中…' : '—'}
          hint={r.monthly ? `最差 5% 的月份平均虧 ${pct(r.monthly.cvar)}；VaR ${pct(r.monthly.var)}` : '需要一年的日線'}
        />
        <StatTile
          label="最壞歷史情境"
          value={r.worstHistorical ? twd(r.worstHistorical.result.lossTwd) : '—'}
          hint={r.worstHistorical ? `${r.worstHistorical.scenario.label}重演：${r.worstHistorical.result.lossPercent.toFixed(1)}%` : '還沒有持股'}
        />
        <StatTile
          label="距熔斷還能跌"
          value={r.breakerFall === null ? '不會觸發' : `大盤 −${r.breakerFall.toFixed(0)}%`}
          hint={`觸發 −${policy.drawdownCircuitBreakerPercent}% 熔斷；${r.limitFall === null ? '不會' : `大盤 −${r.limitFall.toFixed(0)}% 會`}超過可承受 −${policy.maxDrawdownTolerancePercent}%`}
        />
        <StatTile
          label="生活費緩衝"
          value={r.bufferMonths === null ? '—' : `${r.bufferMonths.toFixed(1)} 個月`}
          hint={r.withdrawalAfterWorst ? `最壞情境後提領率 ${r.withdrawalAfterWorst.toFixed(1)}%（現在 ${r.withdrawalNow?.toFixed(1)}%）` : '緩衝放在現金或短債，不受股市影響'}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="風險集中在哪幾檔" description="風險貢獻：每檔占組合波動的比例。權重小但波動大、和其他持股同漲同跌的，貢獻會比權重高。">
          <DataTable<PositionRisk>
            rows={r.positions}
            rowKey={(p) => p.id}
            limit={5}
            columns={[
              { key: 'label', label: '持股', render: (p) => p.label },
              { key: 'weight', label: '權重', numeric: true, render: (p) => pct(p.weight), sortValue: (p) => p.weight },
              { key: 'rc', label: '風險貢獻', numeric: true, render: (p) => pct(p.contribution), sortValue: (p) => p.contribution },
              { key: 'vol', label: '年化波動', numeric: true, render: (p) => (p.source === 'none' ? '—' : pct(p.vol, 0)), sortValue: (p) => p.vol },
              { key: 'src', label: '資料', render: (p) => <span className="text-xs text-gray-600 dark:text-gray-400">{SOURCE_LABEL[p.source]}</span> },
            ]}
          />
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400">年化波動</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">{pct(r.vol)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400"><Term name="β值">貝他</Term>（對加權指數）</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">{r.beta === null ? '—' : r.beta.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400"><Term name="有效持股數" /></dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">{r.concentration.effective.toFixed(1)} 檔</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400">美元曝險</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">{r.usdExposurePercent.toFixed(1)}%</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            交易部位風險預算：已用 {twd(r.budget.used)}／{twd(r.budget.budget)}（{pct(r.budget.ratio, 0)}，{r.budget.open} 張進行中的計畫單）
            {r.budget.ratio > 1 && (
              <span className="ml-2">
                <Badge tone="bad">超過預算</Badge>
              </span>
            )}
          </p>
          {r.proxies.length > 0 && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">沒有日線的持股：{r.proxies.join('、')}。美元資產以美元計算波動，匯率風險看壓力測試的匯率情境。</p>}
          <Disclosure summary={`相關性（權重最大的 ${r.correlation.labels.length} 檔）`}>
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="p-1" />
                    {r.correlation.labels.map((l) => (
                      <th key={l} className="p-1 text-left font-medium text-gray-600 dark:text-gray-400">
                        {l.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.correlation.matrix.map((row, i) => (
                    <tr key={r.correlation.labels[i]}>
                      <th className="whitespace-nowrap p-1 text-left font-medium text-gray-600 dark:text-gray-400">{r.correlation.labels[i].split(' ')[0]}</th>
                      {row.map((c, j) => (
                        <td key={j} className="p-1 text-right tabular-nums text-gray-800 dark:text-gray-200">
                          {c === null ? '—' : c.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </Card>

        <Card title="回撤與暫停規則" description="熔斷與可承受回撤來自投資政策；暫停規則只管交易部位的新建倉。">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400">目前回撤</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">
                {pct(r.drawdown.current)}
                {r.drawdown.days > 0 && <span className="ml-1 text-xs font-normal text-gray-600 dark:text-gray-400">（{r.drawdown.days} 天）</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400">紀錄中最大回撤</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">{pct(r.drawdown.worst)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400">連續虧損</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">
                {pause.streak}／{pause.streakLimit} 筆 {pause.streakPaused && <Badge tone="bad">暫停中</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-600 dark:text-gray-400">本月已實現損益</dt>
              <dd className="font-medium text-gray-900 dark:text-gray-100">
                {pause.monthPercent >= 0 ? '+' : ''}
                {pause.monthPercent.toFixed(1)}%（上限 −{pause.monthLimit}%）{pause.monthPaused && <Badge tone="bad">暫停中</Badge>}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <DrawdownChart />
          </div>
          {pause.streakPaused && (
            <div className="mt-4">
              <PauseReviewForm pause={pause} />
            </div>
          )}
          {reviews.length > 0 && (
            <Disclosure summary={`暫停檢討紀錄（${reviews.length}）`}>
              <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {[...reviews].reverse().map((v) => (
                  <li key={v.id}>
                    {v.date}（連續 {v.streak} 筆）：{v.notes}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <StressCard rows={r.results} breaker={policy.drawdownCircuitBreakerPercent} limit={policy.maxDrawdownTolerancePercent} onCustom={setCustom} />
      </div>
    </div>
  )
}
