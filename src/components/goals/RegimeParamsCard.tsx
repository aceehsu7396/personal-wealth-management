import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { useRegime } from '../../lib/market/useRegime'
import { ADD_ON_LABELS, COOLING_OFF_DAYS, REGIME_LABELS } from '../../lib/market/regime'
import { ENTRY_METHOD_LABELS } from '../../lib/trades/tradePlan'
import { AddOnRuleSchema, EntryMethodSchema, RegimeParamRowSchema, type RegimeParamRow } from '../../lib/storage/schema'
import { Field, inputClass } from '../forms/FormField'
import { Badge, Card, Disclosure, secondaryButton } from '../ui'

const thClass = 'py-2 pr-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400'
const tdClass = 'py-2 pr-3 align-top text-sm text-gray-800 dark:text-gray-200'

function RowEditor({ row, onChange }: { row: RegimeParamRow; onChange: (row: RegimeParamRow) => void }) {
  const toggle = (m: RegimeParamRow['allowedEntries'][number]) =>
    onChange({ ...row, allowedEntries: row.allowedEntries.includes(m) ? row.allowedEntries.filter((x) => x !== m) : [...row.allowedEntries, m] })
  return (
    <fieldset className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{REGIME_LABELS[row.regime]}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="部位倍數（0 到 1）">
          <input type="number" step="0.05" min="0" max="1" className={inputClass} value={row.sizeMultiplier} onChange={(e) => onChange({ ...row, sizeMultiplier: Number(e.target.value) })} />
        </Field>
        <Field label="初始停損（ATR 倍數）">
          <input type="number" step="0.5" min="0.5" max="4" className={inputClass} value={row.stopAtr} onChange={(e) => onChange({ ...row, stopAtr: Number(e.target.value) })} />
        </Field>
        <Field label="加碼">
          <select className={inputClass} value={row.addOn} onChange={(e) => onChange({ ...row, addOn: AddOnRuleSchema.parse(e.target.value) })}>
            {AddOnRuleSchema.options.map((o) => (
              <option key={o} value={o}>
                {ADD_ON_LABELS[o]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">允許的進場方法</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {EntryMethodSchema.options.map((m) => (
          <label key={m} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={row.allowedEntries.includes(m)} onChange={() => toggle(m)} />
            {ENTRY_METHOD_LABELS[m]}
          </label>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="獲利了結">
          <input className={inputClass} value={row.takeProfit} onChange={(e) => onChange({ ...row, takeProfit: e.target.value })} />
        </Field>
        <Field label="核心部位">
          <input className={inputClass} value={row.core} onChange={(e) => onChange({ ...row, core: e.target.value })} />
        </Field>
      </div>
    </fieldset>
  )
}

// The signed regime parameter table (blueprint 02 §3.9, 01 §C6): one row per
// regime; editing needs a reason and a signature, then a cooling-off week.
export function RegimeParamsCard() {
  const params = useAppStore((s) => s.regimeParams)
  const versions = useAppStore((s) => s.ruleVersions)
  const sign = useAppStore((s) => s.signRegimeParams)
  const { ctx } = useRegime()
  const [draft, setDraft] = useState<RegimeParamRow[] | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()

  useEffect(() => {
    if (hash === '#regime-params') ref.current?.scrollIntoView({ block: 'start' })
  }, [hash])

  const history = versions.filter((v) => v.kind === 'regime_params').reverse()
  const submit = () => {
    if (!draft) return
    const bad = draft.filter((r) => !RegimeParamRowSchema.safeParse(r).success).map((r) => REGIME_LABELS[r.regime])
    if (bad.length > 0) return setError(`數值超出範圍：${bad.join('、')}。部位倍數 0 到 1，停損 0.5 到 4 倍 ATR。`)
    if (!reason.trim()) return setError('請寫下修改理由。')
    sign(draft, reason.trim())
    setDraft(null)
    setReason('')
    setError(null)
  }

  return (
    <div ref={ref} className="mt-8 scroll-mt-4">
      <Card
        title="局勢參數表"
        description={`局勢決定新計畫單套用哪一列。參數只能讓交易更保守：部位倍數不超過 1。修改要寫理由並簽署，簽署後 ${COOLING_OFF_DAYS} 天為冷靜期。`}
        action={
          draft ? undefined : (
            <button type="button" className={secondaryButton} onClick={() => setDraft(params.rows.map((r) => ({ ...r, allowedEntries: [...r.allowedEntries] })))}>
              編輯
            </button>
          )
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {params.signedAt ? `✓ 已於 ${params.signedAt.slice(0, 10)} 簽署` : '尚未簽署：目前使用手冊 01 §C6 的示例值，請依自己的投資政策檢查後簽署。'}
          {ctx && `　目前局勢：${ctx.label}`}
        </p>

        {draft ? (
          <div className="mt-4 space-y-4">
            {draft.map((row, i) => (
              <RowEditor key={row.regime} row={row} onChange={(next) => setDraft(draft.map((r, k) => (k === i ? next : r)))} />
            ))}
            <Field label="修改理由（必填，會留在簽署紀錄）">
              <textarea rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={secondaryButton} onClick={submit}>
                簽署局勢參數表
              </button>
              <button
                type="button"
                className="text-sm text-gray-600 hover:underline dark:text-gray-400"
                onClick={() => {
                  setDraft(null)
                  setError(null)
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {['局勢', '允許的進場', '倍數', '停損', '加碼', '獲利了結', '核心部位'].map((h) => (
                    <th key={h} className={thClass}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {params.rows.map((r) => {
                  const current = ctx?.regime === r.regime
                  return (
                    <tr key={r.regime} className={`border-b border-gray-100 last:border-0 dark:border-gray-700 ${current ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}>
                      <td className={`${tdClass} whitespace-nowrap font-medium`}>
                        {REGIME_LABELS[r.regime]} {current && <Badge tone="good">目前</Badge>}
                      </td>
                      <td className={tdClass}>{r.allowedEntries.length > 0 ? r.allowedEntries.map((m) => ENTRY_METHOD_LABELS[m]).join('、') : '暫停新建倉'}</td>
                      <td className={`${tdClass} tabular-nums`}>{r.sizeMultiplier}</td>
                      <td className={`${tdClass} whitespace-nowrap`}>{r.stopAtr} ATR</td>
                      <td className={`${tdClass} whitespace-nowrap`}>{ADD_ON_LABELS[r.addOn]}</td>
                      <td className={tdClass}>{r.takeProfit}</td>
                      <td className={tdClass}>{r.core}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {history.length > 0 && (
          <Disclosure summary={`簽署紀錄（${history.length}）`}>
            <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {history.map((v) => (
                <li key={v.id}>
                  {v.at.slice(0, 10)}：{v.reason}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </Card>
    </div>
  )
}
