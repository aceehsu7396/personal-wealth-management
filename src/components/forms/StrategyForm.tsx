import { useState } from 'react'
import { STRATEGY_TEMPLATES, defaultParams, parseSymbolList, resolveParams } from '../../lib/backtest/templates'
import { useAppStore } from '../../lib/storage/appStore'
import type { StrategyTemplate, TradingStrategy } from '../../lib/storage/schema'
import { Field, inputClass, labelClass } from './FormField'

export type StrategyFormValues = Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt' | 'status'>

interface Props {
  initial?: TradingStrategy
  defaultRiskPercent: number
  onSubmit: (values: StrategyFormValues) => void
  onCancel: () => void
}

// The written trading plan: template + parameters, symbols, the edge it
// claims, entry/exit rules and risk per trade.
export function StrategyForm({ initial, defaultRiskPercent, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [template, setTemplate] = useState<StrategyTemplate>(initial?.template ?? 'ma_cross')
  const [params, setParams] = useState<Record<string, number>>(
    initial ? resolveParams(initial.template, initial.params) : defaultParams('ma_cross'),
  )
  const [symbols, setSymbols] = useState(initial?.symbols.join(', ') ?? '0050')
  const [edge, setEdge] = useState(initial?.edge ?? '')
  const [entryRules, setEntryRules] = useState(initial?.entryRules ?? STRATEGY_TEMPLATES.ma_cross.entry)
  const [exitRules, setExitRules] = useState(initial?.exitRules ?? STRATEGY_TEMPLATES.ma_cross.exit)
  const [risk, setRisk] = useState(String(initial?.riskPerTradePercent ?? defaultRiskPercent))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const def = STRATEGY_TEMPLATES[template]
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

      {def.params.map((param) => (
        <Field key={param.key} label={param.label}>
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
      ))}

      <label className="block sm:col-span-2">
        <span className={labelClass}>標的（逗號分隔；台股直接寫代號，美股寫 US:代號）</span>
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
      <Field label="每筆停損風險（占交易部位 %）">
        <input type="number" step="0.1" className={inputClass} value={risk} onChange={(e) => setRisk(e.target.value)} />
      </Field>
      <Field label="備註（適用的市場環境、已知弱點）">
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {error && <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {initial ? '儲存策略卡' : '新增策略卡'}
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
