import { useState } from 'react'
import { costSensitivity, dailyReturnsOf, deflatedSharpe, walkForward, type BacktestInput, type BacktestResult } from '../../lib/backtest/engine'
import { STRATEGY_TEMPLATES } from '../../lib/backtest/templates'
import { Badge, secondaryButton } from '../ui'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

type Checks = {
  wf: ReturnType<typeof walkForward>
  dsr: ReturnType<typeof deflatedSharpe>
  cost: ReturnType<typeof costSensitivity>
}

// Three guards against a backtest that only looks good (blueprint 02 §7.1):
// walk-forward, a Sharpe ratio deflated for the number of tries, and costs.
export function BiasChecks({ input, result, trials, sweepKey }: { input: BacktestInput; result: BacktestResult; trials: number; sweepKey?: string }) {
  const [checks, setChecks] = useState<Checks | null>(null)
  const [busy, setBusy] = useState(false)
  const key = sweepKey || STRATEGY_TEMPLATES[input.template].params[0]?.key

  const run = () => {
    setBusy(true)
    // Let the button repaint before the heavy loop.
    setTimeout(() => {
      setChecks({ wf: key ? walkForward(input, key) : null, dsr: deflatedSharpe(dailyReturnsOf(result), trials), cost: costSensitivity(input) })
      setBusy(false)
    }, 20)
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-4 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">偏誤檢查</h3>
        <button type="button" className={secondaryButton} onClick={run} disabled={busy}>
          {busy ? '計算中…' : checks ? '重新檢查' : '執行偏誤檢查'}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">回測好看不等於有優勢：參數可能是挑出來的、試太多次總會碰到好結果、成本一高優勢就沒了。三項各自檢查一種。</p>
      {checks && (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="text-sm">
            <p className="font-medium text-gray-900 dark:text-gray-100">walk-forward（{checks.wf?.label ?? '—'}）</p>
            {checks.wf ? (
              <>
                <p className="mt-1 text-gray-700 dark:text-gray-300">
                  每段只用之前的資料挑參數：年化 {pct(checks.wf.cagr)}、最大回撤 {pct(checks.wf.maxDrawdown)}；固定參數 {pct(checks.wf.fixedCagr)}、{pct(checks.wf.fixedMaxDrawdown)}。
                </p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">挑選的值：{checks.wf.segments.map((s) => s.value).join('、')}</p>
                <p className="mt-1">{checks.wf.cagr < checks.wf.fixedCagr / 2 ? <Badge tone="warn">挑參數的結果差很多：目前的參數可能是事後選的</Badge> : <Badge tone="good">和固定參數相近</Badge>}</p>
              </>
            ) : (
              <p className="mt-1 text-gray-600 dark:text-gray-400">資料太短或沒有可調的參數。</p>
            )}
          </section>
          <section className="text-sm">
            <p className="font-medium text-gray-900 dark:text-gray-100">試過 {trials} 次的夏普比率</p>
            {checks.dsr ? (
              <>
                <p className="mt-1 text-gray-700 dark:text-gray-300">
                  夏普 {checks.dsr.sharpe.toFixed(2)}；只靠運氣試 {checks.dsr.trials} 次也可能碰到 {checks.dsr.luckSharpe.toFixed(2)}。真的勝過運氣的機率 {(checks.dsr.probability * 100).toFixed(0)}%。
                </p>
                <p className="mt-1">{checks.dsr.probability < 0.95 ? <Badge tone="warn">可能是試出來的</Badge> : <Badge tone="good">{checks.dsr.trials > 1 ? '試了這麼多次仍然顯著' : '夏普比率顯著大於 0'}</Badge>}</p>
              </>
            ) : (
              <p className="mt-1 text-gray-600 dark:text-gray-400">報酬資料太少。</p>
            )}
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">次數 = 這張策略卡儲存過的回測 + 參數掃描的組合 + 這次。</p>
          </section>
          <section className="text-sm">
            <p className="font-medium text-gray-900 dark:text-gray-100">交易成本敏感度</p>
            <table className="mt-1 text-xs">
              <thead>
                <tr className="text-left text-gray-600 dark:text-gray-400">
                  <th className="pr-4 font-medium">成本</th>
                  <th className="pr-4 font-medium">年化</th>
                  <th className="font-medium">夏普</th>
                </tr>
              </thead>
              <tbody className="text-gray-800 dark:text-gray-200">
                {checks.cost.rows.map((r) => (
                  <tr key={r.multiple}>
                    <td className="pr-4">×{r.multiple}</td>
                    <td className="pr-4 tabular-nums">{pct(r.cagr)}</td>
                    <td className="tabular-nums">{r.sharpe === null ? '—' : r.sharpe.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1">{checks.cost.sensitive ? <Badge tone="warn">對成本敏感：成本加倍，優勢少一半以上</Badge> : <Badge tone="good">成本加倍仍有優勢</Badge>}</p>
          </section>
        </div>
      )}
    </div>
  )
}
