import { useState } from 'react'
import { STRATEGY_TEMPLATES, defaultParams, parseSymbolList, resolveParams } from '../../lib/backtest/templates'
import { useAppStore } from '../../lib/storage/appStore'
import type { Cadence, LibraryTemplate, StrategyTemplate, TradingStrategy } from '../../lib/storage/schema'
import { CADENCE_TEMPLATES, DEFAULT_DECISION_DAY, isWeeklyTemplate, WEEKDAY_LABELS } from '../../lib/backtest/weekly'
import { Field, inputClass, labelClass } from './FormField'
import { ParamHelp } from '../ParamHelp'

export type StrategyFormValues = Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt' | 'status'>
// A template library entry: the card fields without risk, plus who it
// suits, its main risk, its role and whether comparisons run it.
export type TemplateFormValues = Omit<LibraryTemplate, 'id' | 'builtIn'>

interface Props {
  initial?: TradingStrategy
  // Starting values for a new card (e.g. from a research card link).
  draft?: Partial<StrategyFormValues>
  defaultRiskPercent: number
  onSubmit: (values: StrategyFormValues) => void
  onCancel: () => void
  // Template library mode: edits this entry (or a new one) instead.
  libraryEntry?: LibraryTemplate | 'new'
  onSubmitTemplate?: (values: TemplateFormValues) => void
}

// The written trading plan: template + parameters, symbols, the edge it
// claims, entry/exit rules and risk per trade.
export function StrategyForm({ initial, draft, defaultRiskPercent, onSubmit, onCancel, libraryEntry, onSubmitTemplate }: Props) {
  const isTemplate = libraryEntry !== undefined
  const entry = libraryEntry === 'new' ? undefined : libraryEntry
  const start: Partial<StrategyFormValues> | undefined = initial ?? entry ?? draft
  const [name, setName] = useState(start?.name ?? '')
  const [template, setTemplate] = useState<StrategyTemplate>(start?.template ?? 'ma_cross')
  const [params, setParams] = useState<Record<string, number>>(
    start?.template ? resolveParams(start.template, start.params ?? {}) : defaultParams('ma_cross'),
  )
  const [symbols, setSymbols] = useState(start?.symbols?.map((x) => (x.startsWith('TW:') ? x.slice(3) : x)).join(', ') ?? (isTemplate ? '' : '0050'))
  const [edge, setEdge] = useState(start?.edge ?? '')
  const [entryRules, setEntryRules] = useState(start?.entryRules ?? STRATEGY_TEMPLATES[start?.template ?? 'ma_cross'].entry)
  const [exitRules, setExitRules] = useState(start?.exitRules ?? STRATEGY_TEMPLATES[start?.template ?? 'ma_cross'].exit)
  const [risk, setRisk] = useState(String(start?.riskPerTradePercent ?? defaultRiskPercent))
  const [notes, setNotes] = useState(start?.notes ?? '')
  const [suits, setSuits] = useState(entry?.suits ?? '')
  const [riskText, setRiskText] = useState(entry?.risk ?? '')
  const [inCompare, setInCompare] = useState(entry?.inCompare ?? true)
  const [cadence, setCadence] = useState<Cadence>(start?.cadence ?? 'daily')
  // 0 = the site-wide setting.
  const [decisionDay, setDecisionDay] = useState(initial?.decisionDay ?? draft?.decisionDay ?? 0)
  const globalDay = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay ?? DEFAULT_DECISION_DAY)
  const [error, setError] = useState<string | null>(null)

  const def = STRATEGY_TEMPLATES[template]
  const weeklyOnly = isWeeklyTemplate(template)
  const canChoose = CADENCE_TEMPLATES.includes(template)
  const effective: Cadence = weeklyOnly ? 'weekly' : canChoose ? cadence : 'daily'
  // Always written out, so switching back to daily clears a saved weekly.
  const cadenceFields = (withDay: boolean) => ({
    cadence: effective,
    ...(withDay ? { decisionDay: effective === 'weekly' && decisionDay > 0 ? decisionDay : undefined } : {}),
  })
  const watchlist = useAppStore((s) => s.watchlist)

  function addFromWatchlist() {
    const merged = parseSymbolList([symbols, ...watchlist.map((w) => w.symbol)].join(','))
    setSymbols(merged.map((s) => (s.startsWith('TW:') ? s.slice(3) : s)).join(', '))
  }

  function changeTemplate(next: StrategyTemplate) {
    const prev = STRATEGY_TEMPLATES[template]
    setTemplate(next)
    setParams(defaultParams(next))
    // Replace the rule text only while it is still the previous template's.
    if (entryRules === prev.entry) setEntryRules(STRATEGY_TEMPLATES[next].entry)
    if (exitRules === prev.exit) setExitRules(STRATEGY_TEMPLATES[next].exit)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const list = parseSymbolList(symbols)
    const riskPercent = Number(risk)
    if (!name.trim()) return setError('請填寫策略名稱')
    if (isTemplate) {
      if (def.multiSymbol && list.length === 1) return setError('動能輪動至少需要 2 個標的，或留空')
      setError(null)
      return onSubmitTemplate?.({
        name: name.trim(),
        template,
        params,
        symbols: list,
        edge: edge.trim(),
        entryRules: entryRules.trim(),
        exitRules: exitRules.trim(),
        suits: suits.trim(),
        risk: riskText.trim(),
        notes: notes.trim(),
        role: template === 'buy_hold' || template === 'dca' ? 'benchmark' : 'signal',
        inCompare: inCompare && def.backtestable,
        ...cadenceFields(false),
      })
    }
    if (def.backtestable && list.length === 0) return setError('請填寫至少一個標的')
    if (def.multiSymbol && list.length < 2) return setError('動能輪動至少需要 2 個標的')
    if (!(riskPercent > 0 && riskPercent <= 5)) return setError('每筆風險須介於 0–5%')
    setError(null)
    onSubmit({
      name: name.trim(),
      template,
      params,
      symbols: list,
      edge: edge.trim(),
      entryRules: entryRules.trim(),
      exitRules: exitRules.trim(),
      riskPerTradePercent: riskPercent,
      notes: notes.trim(),
      ...cadenceFields(true),
    })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="策略名稱">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：0050 均線趨勢" />
      </Field>
      <Field label="策略範本">
        <select className={inputClass} value={template} onChange={(e) => changeTemplate(e.target.value as StrategyTemplate)}>
          {Object.entries(STRATEGY_TEMPLATES).map(([key, t]) => (
            <option key={key} value={key}>
              {t.label}（{t.origin}）
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-gray-500 sm:col-span-2 dark:text-gray-400">{def.summary}</p>

      {(weeklyOnly || canChoose) && (
        <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
          <Field label="判斷頻率">
            <select className={inputClass} value={effective} disabled={weeklyOnly} onChange={(e) => setCadence(e.target.value as Cadence)}>
              <option value="daily">每日收盤判斷</option>
              <option value="weekly">每週判斷一次（判斷日收盤，下個交易日開盤）</option>
            </select>
          </Field>
          {effective === 'weekly' && !isTemplate && (
            <Field label="每週判斷日">
              <select className={inputClass} value={decisionDay} onChange={(e) => setDecisionDay(Number(e.target.value))}>
                <option value={0}>依設定（{WEEKDAY_LABELS[globalDay]}）</option>
                {Object.entries(WEEKDAY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}收盤
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-xs text-gray-500 sm:col-span-2 dark:text-gray-400">
            {weeklyOnly ? '週線範本一律每週判斷。' : '每週判斷時，進出場只在判斷日收盤決定；'}停損每天照常觸發。說明見手冊 10 §6.6。
          </p>
        </div>
      )}

      {def.params.map((param) => (
        <div key={param.key}>
          <Field label={param.label}>
            <input
              type="number"
              className={inputClass}
              min={param.min}
              max={param.max}
              step={param.step}
              value={params[param.key] ?? param.default}
              onChange={(e) => setParams({ ...params, [param.key]: Number(e.target.value) })}
            />
          </Field>
          <ParamHelp help={param.help} range={{ min: param.min, max: param.max, default: param.default }} />
        </div>
      ))}

      <label className="block sm:col-span-2">
        <span className={labelClass}>{isTemplate ? '預設標的（可留空：比較或套用時用當下輸入的標的）' : '標的（逗號分隔；台股直接寫代號，美股寫 US:代號）'}</span>
        <input className={inputClass} value={symbols} onChange={(e) => setSymbols(e.target.value)} placeholder="0050, 006208, US:SPY" />
        {watchlist.length > 0 && (
          <button type="button" onClick={addFromWatchlist} className="mt-1 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
            從觀察名單加入（{watchlist.length} 檔）
          </button>
        )}
      </label>
      <label className="block sm:col-span-2">
        <span className={labelClass}>優勢：為什麼這個策略長期能賺錢？誰在虧錢給你？</span>
        <textarea rows={2} className={inputClass} value={edge} onChange={(e) => setEdge(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>進場規則</span>
        <textarea rows={3} className={inputClass} value={entryRules} onChange={(e) => setEntryRules(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>出場規則（含停損）</span>
        <textarea rows={3} className={inputClass} value={exitRules} onChange={(e) => setExitRules(e.target.value)} />
      </label>
      {isTemplate ? (
        <>
          <Field label="適合誰">
            <input className={inputClass} value={suits} onChange={(e) => setSuits(e.target.value)} />
          </Field>
          <Field label="主要風險">
            <input className={inputClass} value={riskText} onChange={(e) => setRiskText(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2 dark:text-gray-300">
            <input type="checkbox" checked={inCompare && def.backtestable} disabled={!def.backtestable} onChange={(e) => setInCompare(e.target.checked)} />
            納入策略比較{!def.backtestable && '（這個範本無法回測）'}
            {(template === 'buy_hold' || template === 'dca') && <span className="text-xs text-gray-500 dark:text-gray-400">・作為基準</span>}
          </label>
        </>
      ) : (
        <div>
          <Field label="每筆停損風險（占交易部位 %）">
            <input type="number" step="0.1" className={inputClass} value={risk} onChange={(e) => setRisk(e.target.value)} />
          </Field>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            投資政策上限 {defaultRiskPercent}%；策略卡可以設得更低（例如新策略 0.5%），高於上限時以上限為準。回測的風險部位法與實單的交易前檢核都會用這個值。
          </p>
        </div>
      )}
      <Field label="備註（適用的市場環境、已知弱點）">
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {error && <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {isTemplate ? (entry ? '儲存範本' : '新增範本') : initial ? '儲存策略卡' : '新增策略卡'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          取消
        </button>
      </div>
    </form>
  )
}
