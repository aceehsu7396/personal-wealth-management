import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  benchmarkInput,
  coreTradingMix,
  parameterSweep,
  runBacktest,
  sensitivityGrid,
  splitStats,
  weeklySample,
  type BacktestInput,
  type MixRow,
  type ParameterSweep,
  type StatsSplit,
} from '../../lib/backtest/engine'
import { loadPriceData } from '../../lib/backtest/data'
import { STRATEGY_TEMPLATES, formatSymbol, parseSymbolList } from '../../lib/backtest/templates'
import { calmarOf, outOfSampleVerdict } from '../../lib/backtest/passRule'
import { INTERPRET_RULES, interpretBacktest } from '../../lib/backtest/interpret'
import { describeAiError } from '../../lib/ai/client'
import type { BacktestRun, BacktestStats, InvestmentPolicy } from '../../lib/storage/schema'
import { DrawdownChart, EquityChart, SweepChart } from '../charts/BacktestCharts'
import { inputClass, labelClass } from '../forms/FormField'
import { Term } from '../Term'
import { BiasChecks } from './BiasChecks'
import { secondaryButton } from '../ui'

const thClass = 'py-2 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 text-gray-700 dark:text-gray-300'
const outlineButton =
  'rounded-md border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30'

function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
}

function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}

const STAT_ROWS: { label: string; get: (s: BacktestStats) => string }[] = [
  { label: '總報酬', get: (s) => pct(s.totalReturn) },
  { label: '年化報酬', get: (s) => pct(s.cagr) },
  { label: '最大回撤', get: (s) => pct(s.maxDrawdown) },
  { label: '夏普比率', get: (s) => num(s.sharpe) },
  { label: '卡瑪比率', get: (s) => num(calmarOf(s)) },
  { label: '交易次數', get: (s) => String(s.trades) },
  { label: '勝率', get: (s) => pct(s.winRate, 0) },
  { label: '獲利因子', get: (s) => num(s.profitFactor) },
  { label: '持倉時間', get: (s) => pct(s.exposure, 0) },
]

const FINDING_STYLE = {
  warning: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-100',
  caution: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200',
  ok: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-100',
} as const
const FINDING_MARK = { warning: '⚠', caution: '△', ok: '✓' } as const

const strip = (s: StatsSplit) => ({ full: s.full, inSample: s.inSample, outOfSample: s.outOfSample })

export type RunDraft = Omit<BacktestRun, 'id' | 'createdAt' | 'strategyId' | 'label'>

interface Props {
  label: string
  input: BacktestInput
  oosFraction: number
  policy: InvestmentPolicy
  // Templates already tried on these symbols, for the bias checks.
  priorTrials: number
  // A strategy card this row belongs to: saving links the run to it.
  card?: { id: string; name: string; status: string }
  saved: boolean
  onSave: (run: RunDraft) => void
  saveLabel: string
  // Sweep 「套用」: the new value goes back to the comparison's settings.
  onApplyParam: (key: string, value: number) => void
}

// One template in detail, on the data the comparison already loaded
// (handbook 10 §6): the pass verdict, findings, curves, the parameter
// grid and sweep, trades, a core + trading mix and the bias checks.
export function DeepDive({ label, input, oosFraction, policy, priorTrials, card, saved, onSave, saveLabel, onApplyParam }: Props) {
  const output = useMemo(() => {
    const strategy = runBacktest(input)
    const benchmark = runBacktest(benchmarkInput(input))
    const stats = splitStats(strategy, oosFraction)
    const benchStats = splitStats(benchmark, oosFraction)
    const points = weeklySample(strategy.dates, strategy.index, benchmark.index).map((p) => ({ date: p.date, strategy: p.values[0] * 100, benchmark: p.values[1] * 100 }))
    return { strategy, stats, benchStats, points, grid: sensitivityGrid(input, oosFraction), oosStart: stats.splitIndex !== null ? strategy.dates[stats.splitIndex] : null }
  }, [input, oosFraction])
  const [sweepKey, setSweepKey] = useState('')
  const [sweep, setSweep] = useState<ParameterSweep | null>(null)
  const [coreSymbol, setCoreSymbol] = useState('0050')
  const [mix, setMix] = useState<MixRow[] | null>(null)
  const [mixStatus, setMixStatus] = useState<string | null>(null)

  const def = STRATEGY_TEMPLATES[input.template]
  const verdict = outOfSampleVerdict(output.stats.outOfSample, output.benchStats.outOfSample)
  const passed = verdict?.passed ?? false
  const fewSweepTrades = sweep !== null && sweep.points.every((p) => p.trades < INTERPRET_RULES.minTrades)
  const best = mix ? [...mix].sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity))[0] : null

  function runSweep() {
    const key = sweepKey || def.params[0]?.key
    if (key) setSweep(parameterSweep(input, key, oosFraction))
  }

  async function runMix() {
    const core = parseSymbolList(coreSymbol)[0]
    if (!core) return
    setMixStatus('準備核心資料…')
    try {
      const data = await loadPriceData([core], input.start, input.end, (p) => setMixStatus(`下載 ${formatSymbol(p.symbol)} ${p.done}/${p.total}`))
      setMix(coreTradingMix(output.strategy, runBacktest({ ...benchmarkInput(input), data })))
      setMixStatus(null)
    } catch (e) {
      setMixStatus(describeAiError(e))
    }
  }

  function save() {
    onSave({
      template: input.template,
      params: input.params,
      symbols: Object.keys(input.data),
      start: input.start,
      end: input.end,
      initialCapital: input.initialCapital,
      outOfSampleStart: output.oosStart,
      dividendAdjusted: true,
      stats: strip(output.stats),
      benchmark: strip(output.benchStats),
      equity: output.points.map((p) => ({ date: p.date, strategy: p.strategy, benchmark: p.benchmark })),
    })
  }

  return (
    <div className="mt-4 rounded-md border border-indigo-200 p-4 dark:border-indigo-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">深入檢驗：{label}</h3>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            passed ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
          }`}
        >
          {output.stats.outOfSample === null
            ? '未設定樣本外，無法判定'
            : verdict?.route === 'return'
              ? '✓ 通過：樣本外報酬勝過買進持有'
              : verdict?.route === 'risk'
                ? '✓ 通過：樣本外風險調整後勝出'
                : '✗ 未通過：報酬與風險調整後都沒有勝過買進持有'}
        </span>
      </div>
      {verdict && output.stats.outOfSample !== null && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{verdict.reason}</p>}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {output.strategy.dates[0]}～{output.strategy.dates.at(-1)}，{output.strategy.dates.length} 個交易日
        {output.oosStart && `；樣本外自 ${output.oosStart} 起`}。價格已還原除權息。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saved} className={secondaryButton}>
          {saved ? '已儲存' : saveLabel}
        </button>
        {passed && saved && card && (card.status === 'dev' || card.status === 'paper') && (
          <Link to={`/sim/paper?strategy=${encodeURIComponent(card.id)}`} className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-400">
            下一步：開始虛擬交易（進出場助手）→
          </Link>
        )}
        {!saved && <span className="text-xs text-gray-500 dark:text-gray-400">{card ? `存入策略卡「${card.name}」，通過才會計入解鎖實單` : '建立策略卡並存入這次回測（開發中）'}</span>}
      </div>

      <h4 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">解讀</h4>
      <ul className="mt-2 space-y-2">
        {interpretBacktest({
          full: output.stats.full,
          inSample: output.stats.inSample,
          outOfSample: output.stats.outOfSample,
          benchmarkFull: output.benchStats.full,
          benchmarkOutOfSample: output.benchStats.outOfSample,
          grid: output.grid,
          maxDrawdownLimitPercent: policy.maxDrawdownTolerancePercent,
        }).map((f) => (
          <li key={f.title} className={`rounded-md border px-3 py-2 text-sm ${FINDING_STYLE[f.level]}`}>
            <p className="font-medium">
              {FINDING_MARK[f.level]} {f.title}
            </p>
            <p className="mt-0.5 text-xs leading-5 opacity-90">{f.detail}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className={thClass}>指標</th>
              <th className={thClass}>策略・全期</th>
              <th className={thClass}>
                <Term name="樣本內">策略・樣本內</Term>
              </th>
              <th className={thClass}>
                <Term name="樣本外">策略・樣本外</Term>
              </th>
              <th className={thClass}>買進持有・全期</th>
              <th className={thClass}>買進持有・樣本外</th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                <td className={`${tdClass} text-gray-500`}>
                  <Term name={row.label}>{row.label}</Term>
                </td>
                <td className={tdClass}>{row.get(output.stats.full)}</td>
                <td className={tdClass}>{output.stats.inSample ? row.get(output.stats.inSample) : '—'}</td>
                <td className={`${tdClass} font-medium`}>{output.stats.outOfSample ? row.get(output.stats.outOfSample) : '—'}</td>
                <td className={tdClass}>{row.get(output.benchStats.full)}</td>
                <td className={tdClass}>{output.benchStats.outOfSample ? row.get(output.benchStats.outOfSample) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">權益曲線（起始 = 100）</h4>
      <EquityChart data={output.points} oosStart={output.oosStart} />
      <h4 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">回撤</h4>
      <DrawdownChart points={output.points} />

      {output.grid && (
        <>
          <h4 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">參數敏感度（全期年化報酬／樣本外年化報酬）</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">主要參數上下調整 25%。數字應該平滑變化；只有中間那格好看，代表很可能是過度最佳化。</p>
          <div className="mt-2 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className={thClass}>
                    {output.grid.aLabel} ＼ {output.grid.bLabel}
                  </th>
                  {output.grid.bValues.map((b) => (
                    <th key={b} className={thClass}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {output.grid.aValues.map((a) => (
                  <tr key={a}>
                    <td className={`${tdClass} text-gray-500`}>{a}</td>
                    {output.grid!.bValues.map((b) => {
                      const cell = output.grid!.cells.find((c) => c.a === a && c.b === b)!
                      const current = a === input.params[def.params[0].key] && b === input.params[def.params[1].key]
                      return (
                        <td key={b} className={`${tdClass} ${current ? 'font-semibold text-indigo-700 dark:text-indigo-400' : ''}`}>
                          {pct(cell.cagr)}／{pct(cell.oosCagr)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {def.params.length > 0 && (
        <>
          <h4 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">單一參數掃描</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            其他參數固定，把一個參數在允許範圍內取約 7 個值各回測一次。好的設定落在一片「高原」上，前後數值都不差；只有一個值特別好，多半是過度最佳化。 選值時只看全期與樣本內，樣本外留作最後驗證（手冊{' '}
            <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              10 §6.1
            </Link>
            ）。
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <select
              className={`${inputClass} w-auto`}
              value={sweepKey || def.params[0].key}
              onChange={(e) => {
                setSweepKey(e.target.value)
                setSweep(null)
              }}
            >
              {def.params.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={runSweep} className={outlineButton}>
              掃描
            </button>
          </div>
          {sweep && (
            <div className="mt-3">
              <p className={`rounded-md border p-2 text-sm ${sweep.isolatedPeak || fewSweepTrades ? FINDING_STYLE.warning : sweep.cagrSpread > 0.08 ? FINDING_STYLE.caution : FINDING_STYLE.ok}`}>
                {fewSweepTrades
                  ? `${FINDING_MARK.warning} 每個數值的交易次數都少於 ${INTERPRET_RULES.minTrades} 筆（最多 ${Math.max(...sweep.points.map((p) => p.trades))} 筆），差異多半是運氣，不能用來選參數。先用上方「交易筆數不足」的按鈕加入同類標的一起驗證，或延長到 10 年，再掃描。`
                  : sweep.isolatedPeak
                    ? `${FINDING_MARK.warning} 最佳值是孤立的高峰：前後數值都差 3 個百分點以上，換個期間很可能失效。改選高原中間的值。`
                    : sweep.cagrSpread > 0.08
                      ? `${FINDING_MARK.caution} 年化報酬在不同數值間相差 ${pct(sweep.cagrSpread)}，參數影響大；選結果相近的一段區間的中間值。`
                      : `${FINDING_MARK.ok} 各數值的年化報酬相差 ${pct(sweep.cagrSpread)}，結果平滑，這個參數不敏感，照原理選即可。`}
              </p>
              <SweepChart data={sweep.points} current={sweep.points.find((p) => p.current)?.value ?? sweep.points[0].value} label={sweep.label} />
              <div className="overflow-x-auto">
                <table className="mt-2 text-sm">
                  <thead>
                    <tr>
                      {[sweep.label, '全期年化', '最大回撤', '樣本外年化', '交易次數', ''].map((h) => (
                        <th key={h} className={thClass}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sweep.points.map((p) => (
                      <tr key={p.value} className={p.current ? 'font-semibold text-indigo-700 dark:text-indigo-400' : ''}>
                        <td className={tdClass}>
                          {p.value}
                          {p.current ? '（目前）' : ''}
                        </td>
                        <td className={tdClass}>{pct(p.cagr)}</td>
                        <td className={tdClass}>{pct(p.maxDrawdown)}</td>
                        <td className={tdClass}>{pct(p.oosCagr)}</td>
                        <td className={tdClass}>{p.trades}</td>
                        <td className={tdClass}>
                          {!p.current && (
                            <button type="button" onClick={() => onApplyParam(sweep.key, p.value)} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                              套用
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">按「套用」只改上方「調整條件」裡這個範本的參數，要再按「用目前條件再跑」才會重算；交易次數少於 20 筆的結果不具參考性。</p>
            </div>
          )}
        </>
      )}

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">交易明細（{output.strategy.trades.length} 筆）</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {['標的', '進場', '進價', '出場', '出價', '報酬', 'R', '出場原因'].map((h) => (
                  <th key={h} className={thClass}>
                    {h === 'R' ? <Term name="R倍數">R</Term> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {output.strategy.trades.map((t, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
                  <td className={tdClass}>{formatSymbol(t.symbol)}</td>
                  <td className={tdClass}>{t.entryDate}</td>
                  <td className={tdClass}>{num(t.entryPrice)}</td>
                  <td className={tdClass}>{t.exitDate}</td>
                  <td className={tdClass}>{num(t.exitPrice)}</td>
                  <td className={`${tdClass} ${t.pnl >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'}`}>{pct(t.returnPct)}</td>
                  <td className={tdClass}>{num(t.rMultiple, 1)}</td>
                  <td className={tdClass}>{{ signal: '訊號', stop: '停損', rotation: '輪動', end: '期末' }[t.exitReason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="mt-6 rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">核心＋交易組合</h4>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">把資金分成核心 ETF（買進持有）與這個策略，每年 1 月再平衡，比較不同比例的報酬與回撤，找出風險調整後最佳的配置。</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={labelClass}>核心標的</span>
            <input className={inputClass} value={coreSymbol} onChange={(e) => setCoreSymbol(e.target.value)} />
          </label>
          <button type="button" onClick={() => void runMix()} disabled={mixStatus !== null && mixStatus.endsWith('…')} className={outlineButton}>
            計算組合
          </button>
          {mixStatus && <span className="text-xs text-gray-500 dark:text-gray-400">{mixStatus}</span>}
        </div>
        {mix && (
          <table className="mt-3 text-sm">
            <thead>
              <tr>
                {['核心比例', '交易部位', '年化報酬', '最大回撤', '夏普比率'].map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mix.map((r) => {
                const overLimit = -r.maxDrawdown * 100 > policy.maxDrawdownTolerancePercent
                return (
                  <tr key={r.coreWeight} className={r === best ? 'font-semibold text-indigo-700 dark:text-indigo-400' : ''}>
                    <td className={tdClass}>{(r.coreWeight * 100).toFixed(0)}%</td>
                    <td className={tdClass}>{((1 - r.coreWeight) * 100).toFixed(0)}%</td>
                    <td className={tdClass}>{pct(r.cagr)}</td>
                    <td className={`${tdClass} ${overLimit ? 'text-orange-700 dark:text-orange-400' : ''}`}>{pct(r.maxDrawdown)}</td>
                    <td className={tdClass}>{num(r.sharpe)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {mix && best && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            粗體為夏普比率最高的組合（核心 {(best.coreWeight * 100).toFixed(0)}%）；橘色回撤超過投資政策上限 −{policy.maxDrawdownTolerancePercent}%。 實際交易部位仍受學習階段上限約束。
          </p>
        )}
      </div>

      <BiasChecks input={input} result={output.strategy} trials={priorTrials + (sweep?.points.length ?? 0) + 1} sweepKey={sweepKey} />
    </div>
  )
}
