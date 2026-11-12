import { useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { TRADE_REASON_LABELS } from '../../lib/calculations/preTradeChecklist'
import { isSatellite } from '../../lib/calculations/portfolioRisk'
import {
  decode,
  detectColumns,
  FIELD_LABELS,
  IMPORTED_CHECKLIST,
  markDuplicates,
  missingFields,
  parseCsv,
  readRows,
  type ImportField,
  type ImportRow,
  type Mapping,
} from '../../lib/trades/brokerImport'
import { TradeReasonSchema, type TradeReason } from '../../lib/storage/schema'
import type { TradeSubmission } from '../forms/TradeForm'
import { inputClass } from '../forms/FormField'
import { Badge, secondaryButton } from '../ui'

const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const MAP_FIELDS: ImportField[] = ['date', 'ticker', 'name', 'side', 'shares', 'lots', 'price', 'fee', 'tax']

interface Choice {
  include: boolean
  reason: TradeReason
  planId: string
}

// Import Fubon's trade-detail CSV into the trade log (blueprint 02 §3.11).
// Each row becomes a trade marked as imported, through the same path as a
// trade typed in, so holdings and trade plans update the same way.
export function BrokerImport({ onImport }: { onImport: (s: TradeSubmission) => void }) {
  const trades = useAppStore((s) => s.trades)
  const holdings = useAppStore((s) => s.holdings)
  const plans = useAppStore((s) => s.tradePlans)
  const [table, setTable] = useState<string[][] | null>(null)
  const [header, setHeader] = useState(0)
  const [mapping, setMapping] = useState<Mapping>({})
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [message, setMessage] = useState<string | null>(null)

  const holdingOf = (ticker: string) => holdings.find((h) => h.ticker === ticker)
  const defaultReason = (r: ImportRow): TradeReason => {
    const core = holdingOf(r.ticker) && !isSatellite(holdingOf(r.ticker)!.sleeve)
    return r.side === 'buy' ? (core ? 'core_dca' : 'tranche_1') : core ? 'rebalance' : 'strategy_exit'
  }
  const missing = table ? missingFields(mapping) : []
  const parsed = table && missing.length === 0 ? readRows(table, header, mapping) : null
  const dupes = parsed ? markDuplicates(parsed.rows, trades) : new Set<number>()
  const choiceOf = (r: ImportRow): Choice => choices[r.line] ?? { include: !dupes.has(r.line), reason: defaultReason(r), planId: '' }

  const load = async (file: File) => {
    const rows = parseCsv(decode(await file.arrayBuffer()))
    const found = detectColumns(rows)
    setTable(rows)
    setHeader(found?.headerRow ?? 0)
    setMapping(found?.mapping ?? {})
    setChoices({})
    setMessage(found ? null : '認不出欄位名稱：請在下方指定每一欄對應的資料。')
  }

  const run = () => {
    if (!parsed) return
    let n = 0
    for (const r of parsed.rows) {
      const c = choiceOf(r)
      if (!c.include) continue
      const holding = holdingOf(r.ticker)
      const sleeve = holding?.sleeve ?? (['core_dca', 'rebalance'].includes(c.reason) ? 'core_tw' : 'satellite_tw')
      onImport({
        trade: {
          date: r.date,
          ticker: r.ticker,
          name: r.name || holding?.name || '',
          holdingId: holding?.id,
          thesisId: holding?.thesisId,
          strategyId: holding?.strategyId,
          planId: c.planId || undefined,
          side: r.side,
          reason: c.reason,
          shares: r.shares,
          price: r.price,
          currency: 'TWD',
          checklist: IMPORTED_CHECKLIST,
          emotion: 3,
          biasNotes: '',
          source: 'broker',
          fee: r.fee,
          tax: r.tax,
        },
        pending: { side: r.side, reason: c.reason, ticker: r.ticker, name: r.name || holding?.name || '', sleeve, currency: 'TWD', shares: r.shares, price: r.price, holdingId: holding?.id, thesisId: holding?.thesisId, strategyId: holding?.strategyId, biasNotes: '' },
      })
      n++
    }
    setMessage(`已匯入 ${n} 筆；略過 ${parsed.rows.length - n} 筆。匯入的交易標記為「券商匯入」，偏誤自問可以之後補寫。`)
    setTable(null)
  }

  const openPlans = plans.filter((p) => p.status === 'draft' || p.status === 'open')

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        上傳富邦證券的成交明細 CSV（Big5 或 UTF-8 都可以）。匯入的交易標記為「券商匯入」：交易前檢核記為「事後匯入，未逐項檢核」，紀律分數裡不算例外、也不算依規交易。
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        沒有檔案可以先試：
        <a href={`${import.meta.env.BASE_URL}samples/fubon-trades-sample.csv`} download className="ml-1 font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          下載範例檔
        </a>
        （虛構資料）。欄位是依常見格式推測的，若你的檔案認不出來，可以在下方自己指定欄位。
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="選擇成交明細 CSV"
        className="block text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm dark:text-gray-300 dark:file:border-gray-600 dark:file:bg-gray-800 dark:file:text-gray-200"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void load(f)
          // Picking the same file again (to re-check it) must still load.
          e.target.value = ''
        }}
      />
      {message && <p className="text-sm text-gray-800 dark:text-gray-200">{message}</p>}

      {table && (
        <details open={missing.length > 0} className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-700">
          <summary className="cursor-pointer text-gray-700 dark:text-gray-300">欄位對應{missing.length > 0 ? `（還缺：${missing.map((f) => FIELD_LABELS[f]).join('、')}）` : '（已自動辨認）'}</summary>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <label className="text-xs text-gray-700 dark:text-gray-300">
              標題列
              <select className={inputClass} value={header} onChange={(e) => setHeader(Number(e.target.value))}>
                {table.slice(0, 15).map((row, i) => (
                  <option key={i} value={i}>
                    第 {i + 1} 列：{row.slice(0, 3).join('、')}
                  </option>
                ))}
              </select>
            </label>
            {MAP_FIELDS.map((f) => (
              <label key={f} className="text-xs text-gray-700 dark:text-gray-300">
                {FIELD_LABELS[f]}
                <select className={inputClass} value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">（沒有）</option>
                  {(table[header] ?? []).map((name, i) => (
                    <option key={i} value={i}>
                      {name || `第 ${i + 1} 欄`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}

      {parsed && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                  {['匯入', '日期', '標的', '買賣', '股數', '成交價', '交易理由', '計畫單'].map((h) => (
                    <th key={h} className="py-1.5 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r) => {
                  const c = choiceOf(r)
                  const set = (patch: Partial<Choice>) => setChoices({ ...choices, [r.line]: { ...c, ...patch } })
                  return (
                    <tr key={r.line} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                      <td className="py-1.5 pr-3">
                        <input type="checkbox" aria-label={`匯入第 ${r.line} 列`} checked={c.include} onChange={(e) => set({ include: e.target.checked })} />
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{r.date}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {r.ticker} {r.name}
                        {dupes.has(r.line) && <span className="ml-1"><Badge tone="info">重複，略過</Badge></span>}
                        {r.margin && <span className="ml-1"><Badge tone="warn">信用交易</Badge></span>}
                      </td>
                      <td className="py-1.5 pr-3">{r.side === 'buy' ? '買進' : '賣出'}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmt(r.shares)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmt(r.price)}</td>
                      <td className="py-1.5 pr-3">
                        <select aria-label={`第 ${r.line} 列交易理由`} className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800" value={c.reason} onChange={(e) => set({ reason: TradeReasonSchema.parse(e.target.value) })}>
                          {TradeReasonSchema.options.map((k) => (
                            <option key={k} value={k}>
                              {TRADE_REASON_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-3">
                        <select aria-label={`第 ${r.line} 列計畫單`} className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800" value={c.planId} onChange={(e) => set({ planId: e.target.value })}>
                          <option value="">（沒有）</option>
                          {openPlans.filter((p) => p.ticker === r.ticker).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.status === 'draft' ? '草稿' : '進行中'}・{p.createdAt.slice(0, 10)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {parsed.skipped.length > 0 && <p className="text-xs text-gray-600 dark:text-gray-400">讀不懂的列：{parsed.skipped.map((s) => `第 ${s.line} 列（${s.reason}）`).join('、')}</p>}
          <button type="button" className={secondaryButton} onClick={run} disabled={!parsed.rows.some((r) => choiceOf(r).include)}>
            匯入勾選的 {parsed.rows.filter((r) => choiceOf(r).include).length} 筆
          </button>
        </>
      )}
    </div>
  )
}
