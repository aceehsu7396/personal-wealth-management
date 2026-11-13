import { useMemo, useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { todayIsoDate } from '../../lib/market/twse'
import { applyShock, exposuresOf } from '../../lib/calculations/stressTest'
import { brierScore, calibration, isBalanced, MIN_BAND_COUNT, probabilityTotal } from '../../lib/calculations/calibration'
import type { Scenario, ScenarioSet } from '../../lib/storage/schema'
import { Field, inputClass } from '../forms/FormField'
import { Badge, Card, Disclosure, secondaryButton } from '../ui'

const twd = (v: number) => `${v < 0 ? '−' : '+'}NT$${Math.round(Math.abs(v)).toLocaleString('zh-TW')}`
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

const emptyScenario = (name: string, probability: number): Scenario => ({ name, probability, trigger: '', signals: '', shock: { tw: 0, us: 0, bond: 0, fx: 0 }, actions: '' })

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

const SHOCK_FIELDS = [
  { key: 'tw', label: '台股 %' },
  { key: 'us', label: '美股 %' },
  { key: 'bond', label: '長債 %' },
  { key: 'fx', label: '美元兌台幣 %' },
] as const

// Two to four scenarios with probabilities, signals and prepared actions;
// scored with the Brier rule once the horizon passes (handbook 05 §8).
export function ScenarioWorkbench() {
  const sets = useAppStore((s) => s.scenarioSets)
  const add = useAppStore((s) => s.addScenarioSet)
  const update = useAppStore((s) => s.updateScenarioSet)
  const holdings = useAppStore((s) => s.holdings)
  const fx = useAppStore((s) => s.portfolioMeta.fxUsdTwd)
  const today = todayIsoDate()
  const [draft, setDraft] = useState<Omit<ScenarioSet, 'id'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Betas of 1: a quick estimate; the risk page uses measured betas.
  const exposures = useMemo(() => exposuresOf(holdings, fx, {}, () => false), [holdings, fx])
  const impact = (s: Scenario) => applyShock(exposures, s.shock).lossTwd
  const summary = calibration(sets)

  const start = () =>
    setDraft({ date: today, question: '', horizon: addMonths(today, 6), premortem: '', scenarios: [emptyScenario('樂觀', 25), emptyScenario('基本', 50), emptyScenario('悲觀', 25)] })
  const setScenario = (i: number, patch: Partial<Scenario>) => draft && setDraft({ ...draft, scenarios: draft.scenarios.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const save = () => {
    if (!draft) return
    if (!draft.question.trim()) return setError('請寫下要推演的問題。')
    if (!isBalanced(draft)) return setError(`機率合計是 ${probabilityTotal(draft)}%，要剛好 100%。`)
    if (draft.scenarios.some((s) => !s.name.trim())) return setError('每個情境都要有名稱。')
    add(draft)
    setDraft(null)
    setError(null)
  }

  const open = sets.filter((s) => s.outcome === undefined).sort((a, b) => a.horizon.localeCompare(b.horizon))
  const resolved = sets.filter((s) => s.outcome !== undefined).sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))

  return (
    <div className="space-y-6">
      <Card
        title="情境工作台"
        description="每次推演寫 2 到 4 個情境：機率、觸發條件、早期訊號、對持股的影響與預備行動。到期後標記實際發生的情境，系統計算布瑞爾分數。"
        action={
          draft ? undefined : (
            <button type="button" className={secondaryButton} onClick={start}>
              新增推演
            </button>
          )
        }
      >
        {draft && (
          <div className="mb-6 space-y-4 rounded-md border border-gray-200 p-4 dark:border-gray-700">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
              <Field label="問題">
                <input className={inputClass} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder="例：未來 6 個月台股會怎麼走" />
              </Field>
              <Field label="到期日">
                <input type="date" className={inputClass} value={draft.horizon} onChange={(e) => setDraft({ ...draft, horizon: e.target.value })} />
              </Field>
            </div>
            {draft.scenarios.map((s, i) => (
              <fieldset key={i} className="rounded-md bg-gray-50 p-3 dark:bg-gray-900/40">
                <legend className="sr-only">情境 {i + 1}</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem]">
                  <Field label={`情境 ${i + 1} 名稱`}>
                    <input className={inputClass} value={s.name} onChange={(e) => setScenario(i, { name: e.target.value })} />
                  </Field>
                  <Field label="機率（%）">
                    <input type="number" min="0" max="100" step="5" className={inputClass} value={s.probability} onChange={(e) => setScenario(i, { probability: Number(e.target.value) })} />
                  </Field>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="觸發條件">
                    <input className={inputClass} value={s.trigger} onChange={(e) => setScenario(i, { trigger: e.target.value })} />
                  </Field>
                  <Field label="早期訊號">
                    <input className={inputClass} value={s.signals} onChange={(e) => setScenario(i, { signals: e.target.value })} />
                  </Field>
                  <Field label="預備行動">
                    <input className={inputClass} value={s.actions} onChange={(e) => setScenario(i, { actions: e.target.value })} />
                  </Field>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {SHOCK_FIELDS.map((f) => (
                    <Field key={f.key} label={f.label}>
                      <input type="number" step="any" className={inputClass} value={s.shock[f.key]} onChange={(e) => setScenario(i, { shock: { ...s.shock, [f.key]: Number(e.target.value) } })} />
                    </Field>
                  ))}
                  <div className="self-end pb-2 text-sm text-gray-700 dark:text-gray-300">對持股：{twd(impact(s))}</div>
                </div>
                {draft.scenarios.length > 2 && (
                  <button type="button" className="mt-2 text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => setDraft({ ...draft, scenarios: draft.scenarios.filter((_, k) => k !== i) })}>
                    移除這個情境
                  </button>
                )}
              </fieldset>
            ))}
            {draft.scenarios.length < 4 && (
              <button type="button" className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-400" onClick={() => setDraft({ ...draft, scenarios: [...draft.scenarios, emptyScenario('', 0)] })}>
                ＋ 加一個情境
              </button>
            )}
            <Field label="事前驗屍：如果每個情境都沒發生，最可能漏掉了什麼">
              <textarea rows={2} className={inputClass} value={draft.premortem} onChange={(e) => setDraft({ ...draft, premortem: e.target.value })} />
            </Field>
            <p className={`text-sm ${isBalanced(draft) ? 'text-gray-700 dark:text-gray-300' : 'text-red-700 dark:text-red-400'}`}>機率合計 {probabilityTotal(draft)}%（要剛好 100%）。對持股的影響以貝他 1 估算。</p>
            {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button type="button" className={secondaryButton} onClick={save}>
                儲存推演
              </button>
              <button type="button" className="text-sm text-gray-600 hover:underline dark:text-gray-400" onClick={() => setDraft(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {open.length === 0 && !draft && <p className="text-sm text-gray-600 dark:text-gray-400">沒有進行中的推演。</p>}
        <ul className="space-y-4">
          {open.map((set) => (
            <li key={set.id} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-gray-900 dark:text-gray-100">{set.question}</p>
                {set.horizon <= today ? <Badge tone="warn">已到期，請標記結果</Badge> : <span className="text-xs text-gray-600 dark:text-gray-400">{set.date} 起，{set.horizon} 到期後才能標記結果</span>}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {set.scenarios.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-10 tabular-nums">{s.probability}%</span>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {s.signals && `訊號：${s.signals}；`}
                      {s.actions && `行動：${s.actions}；`}對持股 {twd(impact(s))}
                    </span>
                    {set.horizon <= today && (
                      <button type="button" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400" onClick={() => update(set.id, { outcome: i, resolvedAt: today })}>
                        標記為實際發生
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="機率校準" description="布瑞爾分數：Σ（機率 − 是否發生）²，越低越好；和「每個情境平均分配機率」比較，才知道判斷有沒有加分。">
        <p className="text-sm text-gray-800 dark:text-gray-200">
          {summary.resolved === 0
            ? '還沒有到期的推演。'
            : `${summary.resolved} 組到期：布瑞爾分數 ${summary.brier!.toFixed(2)}；平均分配機率會得到 ${summary.baseline!.toFixed(2)}。${summary.brier! < summary.baseline! ? '比平均猜測好。' : '沒有比平均猜測好，機率可以給得保守一點。'}`}
        </p>
        {summary.resolved > 0 && (
          <table className="mt-3 w-full max-w-lg text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                <th className="py-1.5 pr-3 font-medium">給的機率</th>
                <th className="py-1.5 pr-3 font-medium">平均預測</th>
                <th className="py-1.5 pr-3 font-medium">實際發生比例</th>
                <th className="py-1.5 font-medium">筆數</th>
              </tr>
            </thead>
            <tbody>
              {summary.bands.map((b) => (
                <tr key={b.label} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className="py-1.5 pr-3">{b.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{pct(b.predicted)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{b.count >= MIN_BAND_COUNT ? pct(b.observed) : b.count > 0 ? '樣本太少' : '—'}</td>
                  <td className="py-1.5 tabular-nums">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {resolved.length > 0 && (
          <Disclosure summary={`已到期的推演（${resolved.length}）`}>
            <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {resolved.map((s) => (
                <li key={s.id}>
                  {s.resolvedAt}：{s.question}——實際是「{s.scenarios[s.outcome!].name}」（當時給 {s.scenarios[s.outcome!].probability}%），布瑞爾 {brierScore(s)!.toFixed(2)}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </Card>
    </div>
  )
}
