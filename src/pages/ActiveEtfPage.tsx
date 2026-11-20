import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useActiveEtf } from '../lib/research/useActiveEtf'
import {
  CHANGE_LABELS,
  STALE_DAYS,
  THIRD_PARTY_LABEL,
  changesOf,
  consensus,
  latestOf,
  previousOf,
  sharesTrend,
  type ChangeKind,
  type EtfSnapshot,
  type HoldingChange,
  type OfficialCheck,
} from '../lib/research/activeEtf'
import { todayIsoDate } from '../lib/market/twse'
import { Badge, Disclosure, PageHeader } from '../components/ui'
import type { Tone } from '../components/ui/tone'

const cardClass = 'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 whitespace-nowrap text-gray-700 dark:text-gray-300'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'
const mutedClass = 'text-xs text-gray-600 dark:text-gray-400'

const lots = (shares: number) => Math.round(shares / 1000).toLocaleString()
const signedLots = (shares: number) => `${shares > 0 ? '+' : ''}${lots(shares)}`
// Tiny positions are rounded to 0 at the source.
const pct = (v: number) => (v < 0.005 ? '<0.01%' : `${v.toFixed(2)}%`)
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const shortDate = (d: string) => d.slice(5).replace('-', '/')
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000

const CHANGE_TONE: Record<ChangeKind, Tone> = { new: 'good', add: 'good', cut: 'warn', removed: 'bad' }
const CHECK_BADGE: Record<OfficialCheck['status'], { tone: Tone; label: string }> = {
  match: { tone: 'good', label: '已與官網比對：一致' },
  mismatch: { tone: 'bad', label: '與官網不一致' },
  unverified: { tone: 'info', label: '未與官網比對' },
}

function StockActions({ code, name, etf }: { code: string; name: string; etf?: string }) {
  const watched = useAppStore((s) => s.watchlist.some((w) => w.symbol === `TW:${code}`))
  const addWatchItem = useAppStore((s) => s.addWatchItem)
  return (
    <span className="flex gap-2">
      <button
        type="button"
        disabled={watched}
        onClick={() => addWatchItem({ symbol: `TW:${code}`, name, industry: '', priceAtAdd: null, source: etf ? `主動 ETF：${etf}` : '主動 ETF 共同持股', note: '' })}
        className={`${linkClass} disabled:text-gray-400 disabled:no-underline`}
      >
        {watched ? '已觀察' : '觀察'}
      </button>
      <Link to={`/research/stocks?new=${code}`} className={linkClass}>
        研究卡
      </Link>
      <Link to={`/sim/compare?symbols=TW:${code}`} className={linkClass}>
        回測
      </Link>
    </span>
  )
}

function CheckNote({ check }: { check?: OfficialCheck }) {
  if (!check) return null
  const badge = CHECK_BADGE[check.status]
  return (
    <div className="mt-2">
      <Badge tone={badge.tone} title={check.note}>
        {badge.label}
      </Badge>
      <p className={`mt-1 ${mutedClass}`}>{check.note}</p>
      {check.status === 'mismatch' && check.diffs.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-red-700 dark:text-red-300">
          {check.diffs.slice(0, 8).map((d) => (
            <li key={d.code}>
              {d.code} {d.name}：第三方 {d.third ? `${lots(d.third.shares)} 張、${pct(d.third.weight)}` : '沒有'}；官網 {d.official ? `${lots(d.official.shares)} 張、${pct(d.official.weight)}` : '沒有'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Shares over the last 20 days as a change from the first day held.
function trendText(series: (number | null)[]): string {
  const held = series.filter((v): v is number => v !== null)
  if (held.length < 2) return '—'
  const first = held[0]
  const last = held[held.length - 1]
  const change = first > 0 ? (last / first - 1) * 100 : 0
  return `${change > 0 ? '+' : ''}${change.toFixed(0)}%（${held.length} 天）`
}

function EtfDetail({ etf, changes, trend }: { etf: EtfSnapshot; changes: HoldingChange[]; trend: (code: string) => (number | null)[] }) {
  const byCode = new Map(changes.map((c) => [c.code, c]))
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">今天的異動（{changes.length} 檔）</h3>
      {changes.length === 0 ? (
        <p className={`mt-1 ${mutedClass}`}>和前一個資料日相比沒有異動，或還沒有前一天的資料。</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {['動作', '股票', '股數變化（張）', '權重', '權重變化', ''].map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.code} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className={tdClass}>
                    <Badge tone={CHANGE_TONE[c.kind]}>{CHANGE_LABELS[c.kind]}</Badge>
                  </td>
                  <td className={tdClass}>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{c.code}</span> {c.name}
                  </td>
                  <td className={tdClass}>{signedLots(c.sharesDelta)}</td>
                  <td className={tdClass}>{c.kind === 'removed' ? '—' : pct(c.weight)}</td>
                  <td className={tdClass}>{signedPct(c.weightDelta)}</td>
                  <td className={tdClass}>
                    <StockActions code={c.code} name={c.name} etf={etf.code} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Disclosure summary={`完整持股（${etf.holdings.length} 檔股票）`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {['股票', '權重', '股數（張）', '今天', '近 20 日股數', ''].map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {etf.holdings.map((h) => {
                const c = byCode.get(h.code)
                return (
                  <tr key={h.code} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                    <td className={tdClass}>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{h.code}</span> {h.name}
                    </td>
                    <td className={tdClass}>{pct(h.weight)}</td>
                    <td className={tdClass}>{lots(h.shares)}</td>
                    <td className={tdClass}>{c ? <Badge tone={CHANGE_TONE[c.kind]}>{`${CHANGE_LABELS[c.kind]} ${signedLots(c.sharesDelta)}`}</Badge> : '—'}</td>
                    <td className={tdClass}>{trendText(trend(h.code))}</td>
                    <td className={tdClass}>
                      <StockActions code={h.code} name={h.name} etf={etf.code} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  )
}

// 研究分析 → 主動式 ETF (handbook 06 §1.2): what the managers of the three
// largest Taiwan active ETFs hold and changed on the latest day.
export function ActiveEtfPage() {
  const { file, loading } = useActiveEtf()
  const [tab, setTab] = useState<string | null>(null)
  const today = todayIsoDate()

  const snaps = (file?.top ?? []).map((c) => file && latestOf(file, c)).filter((s): s is EtfSnapshot => !!s)
  const changes = new Map(snaps.map((s) => [s.code, file ? changesOf(previousOf(file, s.code), s) : []]))
  const rows = file ? consensus(file) : []
  const latestDate = snaps.reduce((m, s) => (s.dataDate > m ? s.dataDate : m), '')
  const stale = latestDate !== '' && daysBetween(latestDate, today) > STALE_DAYS
  const current = snaps.find((s) => s.code === tab) ?? snaps[0]
  const count = (code: string, kind: ChangeKind) => (changes.get(code) ?? []).filter((c) => c.kind === kind).length

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader
        title="主動式 ETF"
        summary={
          <>
            規模前三大的台股主動式 ETF 每天持有什麼、加減碼什麼，當作選股線索：經理人的動作要再經過研究卡體檢，不是買進訊號。持股取自{THIRD_PARTY_LABEL}，統一、復華的基金會再和投信官網比對。說明見手冊{' '}
            <Link to="/handbook/06" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              06 §1.2
            </Link>
            。
          </>
        }
      />

      {loading ? (
        <p className={`mt-8 ${mutedClass}`}>讀取中…</p>
      ) : !file || snaps.length === 0 ? (
        <p className="mt-8 text-sm text-gray-600 dark:text-gray-400">還沒有資料：每天 06:00、07:00 與平日 14:30 更新。</p>
      ) : (
        <>
          {(stale || file.errors.length > 0) && (
            <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {stale && <p>資料停在 {latestDate}，已超過 {STALE_DAYS} 天沒有更新：第三方專案可能暫停，數字只供參考。</p>}
              {file.errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {snaps.map((s, i) => (
              <div key={s.code} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <p className={mutedClass}>
                  規模第 {i + 1}・{s.issuer}
                </p>
                <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                  {s.code} {s.name}
                </p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {Math.round(s.scale / 1e8).toLocaleString()} 億元・{shortDate(s.dataDate)} 持股
                </p>
                <p className={`mt-1 ${mutedClass}`}>
                  新增 {count(s.code, 'new')}、加碼 {count(s.code, 'add')}、減碼 {count(s.code, 'cut')}、剔除 {count(s.code, 'removed')}
                </p>
                <CheckNote check={s.check} />
              </div>
            ))}
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">三檔共同持股（{rows.length} 檔）</h2>
            <p className={`mt-1 ${mutedClass}`}>三檔都持有的股票：最新一天三檔都加碼的排最前面，再來是兩檔加碼，其餘依合計權重。</p>
            {rows.length === 0 ? (
              <p className={`mt-3 ${mutedClass}`}>沒有三檔都持有的股票。</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className={thClass}>股票</th>
                      <th className={thClass}>合計權重</th>
                      {snaps.map((s) => (
                        <th key={s.code} className={thClass}>
                          {s.code}
                        </th>
                      ))}
                      <th className={thClass} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.code} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                        <td className={tdClass}>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{r.code}</span> {r.name}
                          {r.adding >= snaps.length && (
                            <span className="ml-2">
                              <Badge tone="good">三檔同時加碼</Badge>
                            </span>
                          )}
                          {r.adding === 2 && snaps.length > 2 && (
                            <span className="ml-2">
                              <Badge tone="info">兩檔加碼</Badge>
                            </span>
                          )}
                        </td>
                        <td className={tdClass}>{pct(r.totalWeight)}</td>
                        {snaps.map((s) => {
                          const p = r.positions.find((x) => x.etf === s.code)
                          return (
                            <td key={s.code} className={tdClass}>
                              {p ? pct(p.weight) : '—'}
                              {p?.change && <span className={`ml-1 ${p.change.kind === 'cut' || p.change.kind === 'removed' ? 'text-orange-700 dark:text-orange-400' : 'text-indigo-700 dark:text-indigo-300'}`}>{CHANGE_LABELS[p.change.kind]}</span>}
                            </td>
                          )
                        })}
                        <td className={tdClass}>
                          <StockActions code={r.code} name={r.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={cardClass}>
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="選擇 ETF">
              {snaps.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  role="tab"
                  aria-selected={current?.code === s.code}
                  onClick={() => setTab(s.code)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    current?.code === s.code ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700'
                  }`}
                >
                  {s.code} {s.name}
                </button>
              ))}
            </div>
            {current && file && (
              <div className="mt-4">
                <p className={mutedClass}>
                  {shortDate(current.dataDate)} 持股，和 {previousOf(file, current.code) ? shortDate(previousOf(file, current.code)!.dataDate) : '—'} 相比；股數以張（1,000 股）表示，只列股票，不含現金、期貨與選擇權。
                </p>
                <div className="mt-3">
                  <EtfDetail etf={current} changes={changes.get(current.code) ?? []} trend={(code) => sharesTrend(file, current.code, code)} />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
