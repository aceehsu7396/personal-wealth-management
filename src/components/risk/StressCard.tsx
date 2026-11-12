import { useState } from 'react'
import type { StressResult, StressScenario } from '../../lib/calculations/stressTest'
import { Field, inputClass } from '../forms/FormField'
import { Badge, Card, DataTable, secondaryButton } from '../ui'

const twd = (v: number) => `${v < 0 ? '−' : ''}NT$${Math.round(Math.abs(v)).toLocaleString('zh-TW')}`
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`

type Row = { scenario: StressScenario; result: StressResult }

const FIELDS: { key: keyof Pick<StressScenario, 'tw' | 'us' | 'semis' | 'fx' | 'bond'>; label: string }[] = [
  { key: 'tw', label: '台股（%）' },
  { key: 'us', label: '美股（%）' },
  { key: 'semis', label: '半導體（%，空白則跟台股）' },
  { key: 'fx', label: '美元兌新台幣（%，負數＝新台幣升值）' },
  { key: 'bond', label: '長債（%）' },
]

// Historical and hypothetical shocks on today's holdings, with a custom one.
export function StressCard({ rows, breaker, limit, onCustom }: { rows: Row[]; breaker: number; limit: number; onCustom: (s: StressScenario | null) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ tw: '-30', us: '-20', semis: '', fx: '0', bond: '0' })
  const picked = rows.find((r) => r.scenario.id === selected)
  const apply = () => {
    const n = (k: string) => (form[k]?.trim() ? Number(form[k]) : undefined)
    onCustom({ id: 'custom', label: '自訂情境', period: '自訂', kind: 'custom', tw: n('tw') ?? 0, us: n('us') ?? 0, bond: n('bond') ?? 0, fx: n('fx') ?? 0, semis: n('semis') })
    setSelected('custom')
  }
  return (
    <Card title="壓力測試" description={`把歷史上的大跌與假設情境套在今天的持股上。股票依各檔貝他放大或縮小，美元資產另外套用匯率。熔斷 −${breaker}%、可承受回撤 −${limit}%。`}>
      <DataTable<Row>
        rows={rows}
        rowKey={(r) => r.scenario.id}
        limit={12}
        columns={[
          {
            key: 'label',
            label: '情境',
            render: (r) => (
              <button type="button" className="text-left font-medium text-gray-900 hover:underline dark:text-gray-100" onClick={() => setSelected(r.scenario.id === selected ? null : r.scenario.id)} aria-expanded={r.scenario.id === selected}>
                {r.scenario.label}
              </button>
            ),
          },
          { key: 'period', label: '期間', render: (r) => <span className="text-xs text-gray-600 dark:text-gray-400">{r.scenario.period}</span> },
          { key: 'move', label: '台股／美股／匯率', render: (r) => <span className="whitespace-nowrap text-xs">{`${signed(r.scenario.tw)}／${signed(r.scenario.us)}／${signed(r.scenario.fx)}`}</span> },
          { key: 'loss', label: '組合損益', numeric: true, render: (r) => twd(r.result.lossTwd), sortValue: (r) => r.result.lossTwd },
          { key: 'pct', label: '%', numeric: true, render: (r) => signed(r.result.lossPercent), sortValue: (r) => r.result.lossPercent },
          {
            key: 'flag',
            label: '結果',
            render: (r) =>
              r.result.lossPercent <= -limit ? <Badge tone="bad">超過可承受回撤</Badge> : r.result.lossPercent <= -breaker ? <Badge tone="warn">觸發熔斷</Badge> : <Badge tone="info">在範圍內</Badge>,
          },
        ]}
      />
      {picked && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
          <p className="font-medium text-gray-900 dark:text-gray-100">{picked.scenario.label}：虧最多的幾檔</p>
          <ul className="mt-1 space-y-0.5 text-gray-700 dark:text-gray-300">
            {picked.result.worst.length === 0 ? <li>沒有虧損的持股。</li> : picked.result.worst.map((w) => <li key={w.label}>{w.label}：{twd(w.lossTwd)}</li>)}
          </ul>
          {picked.scenario.source && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">資料：{picked.scenario.source}</p>}
        </div>
      )}
      <h3 className="mt-5 text-sm font-semibold text-gray-900 dark:text-gray-100">自訂情境</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input type="number" step="any" className={inputClass} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex gap-3">
        <button type="button" className={secondaryButton} onClick={apply}>
          套用自訂情境
        </button>
        <button
          type="button"
          className="text-sm text-gray-600 hover:underline dark:text-gray-400"
          onClick={() => {
            onCustom(null)
            setSelected(null)
          }}
        >
          清除
        </button>
      </div>
    </Card>
  )
}
