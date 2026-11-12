import { useState } from 'react'
import { Link } from 'react-router-dom'
import { INDEX_DEFS, indexDef, type IndexKey, type IndexMarket, type Reliability } from '../../lib/market/indices'
import { TREND_LABELS, TREND_TONE, flowSums, marginChange, marketSummary, vixBand, type IndexTrend, type Tone } from '../../lib/market/trend'
import { useDailyMarket, type DailyMarket } from '../../lib/market/useDailyMarket'
import { IndexChart } from './IndexChart'
import { FuturesChart } from './FuturesChart'
import { FUTURES_NAME, nightLine, nightReading, type NightReading } from '../../lib/market/futures'

// The chart shows an index, or 台指期 day and night sessions.
type ChartKey = IndexKey | 'FUTURES'

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  bad: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  info: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
}

const RELIABILITY_TONE: Record<Reliability['status'], Tone> = { verified: 'good', unverified: 'info', mismatch: 'warn', stale: 'bad' }

const num = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 })
const signedPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${num.format(Math.abs(v))}%`)
const changeClass = (v: number | null) =>
  v === null ? 'text-gray-500' : v >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-red-600 dark:text-red-400'
const yi = (v: number) => `${v >= 0 ? '+' : '−'}${num.format(Math.round(Math.abs(v) / 1e8))} 億`

function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  )
}

function stateBadge(key: IndexKey, t: IndexTrend) {
  if (key === 'VIX') {
    const band = vixBand(t.close)
    return <Badge tone={band.tone} title="VIX：< 15 平靜、15–25 正常、25–30 警戒、≥ 30 恐慌">{band.label}</Badge>
  }
  if (!t.state) return <Badge tone="info" title={t.stateRule}>資料不足</Badge>
  return (
    <Badge tone={TREND_TONE[t.state]} title={t.stateRule}>
      {TREND_LABELS[t.state]}
    </Badge>
  )
}

function IndexTile({ k, t, selected, onSelect }: { k: IndexKey; t: IndexTrend; selected: boolean; onSelect: () => void }) {
  // VIX is read by its level alone; drawdown and RSI flags do not apply.
  const flags = k === 'VIX' ? [] : t.flags
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-md border p-3 text-left transition-colors ${
        selected
          ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-gray-900'
          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-600 dark:text-gray-400">{indexDef(k).name}</span>
        {stateBadge(k, t)}
      </div>
      <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{num.format(t.close)}</p>
      <p className="text-xs">
        <span className={changeClass(t.changePct)}>{signedPct(t.changePct)}</span>
        {k !== 'VIX' && <span className="ml-2 text-gray-600 dark:text-gray-400">距高點 {signedPct(t.drawdown)}</span>}
      </p>
      {flags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {flags.map((f) => (
            <Badge key={f.label} tone={f.tone} title={f.rule}>
              {f.label}
            </Badge>
          ))}
        </div>
      )}
    </button>
  )
}

function FuturesTile({ r, selected, onSelect }: { r: NightReading; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-md border p-3 text-left transition-colors ${
        selected
          ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-gray-900'
          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-600 dark:text-gray-400">{FUTURES_NAME}夜盤</span>
        <Badge tone="info" title={`${r.span}，近月 ${r.bar.contract}`}>
          {r.bar.date.slice(5)}
        </Badge>
      </div>
      <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{num.format(r.bar.close)}</p>
      <p className="text-xs">
        <span className={changeClass(r.changePct)}>{signedPct(Math.round(r.changePct * 100) / 100)}</span>
        {r.vsSpot !== null && (
          <span className="ml-2 text-gray-600 dark:text-gray-400">
            較現貨 {r.vsSpot >= 0 ? '+' : '−'}
            {num.format(Math.round(Math.abs(r.vsSpot)))}
          </span>
        )}
      </p>
    </button>
  )
}

const MARKET_KEYS: Record<IndexMarket, IndexKey[]> = {
  TW: ['TAIEX', 'TAIEX_TR', 'TPEx'],
  US: ['GSPC', 'IXIC', 'DJI', 'SOX', 'VIX'],
}

function MarketColumn({ market, m, selected, onSelect }: { market: IndexMarket; m: DailyMarket; selected: ChartKey; onSelect: (k: ChartKey) => void }) {
  const data = m.data!
  const lines = marketSummary(market, { trends: m.trends, breadth: data.breadth, flows: data.flows, margin: data.margin, usBreadth: m.usBreadth })
  const night = market === 'TW' ? nightReading(data.futures, data.series.TAIEX ?? []) : null
  // The night session reads right after the index line.
  if (night) lines.splice(1, 0, nightLine(night))
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{market === 'TW' ? '台股' : '美股'}</h3>
        <span className="text-xs text-gray-600 dark:text-gray-400">最新交易日 {m.trends[MARKET_KEYS[market][0]]?.date ?? '—'}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
        {MARKET_KEYS[market].map((k) => {
          const t = m.trends[k]
          return t ? <IndexTile key={k} k={k} t={t} selected={selected === k} onSelect={() => onSelect(k)} /> : null
        })}
        {night && <FuturesTile r={night} selected={selected === 'FUTURES'} onSelect={() => onSelect('FUTURES')} />}
      </div>
    </div>
  )
}

function FlowsTable({ m }: { m: DailyMarket }) {
  const data = m.data!
  const w = flowSums(data.flows, 5)
  const mo = flowSums(data.flows, 20)
  const margin = marginChange(data.margin)
  const rows: [string, string, string][] = [
    ['外資', yi(w.foreign), yi(mo.foreign)],
    ['投信', yi(w.trust), yi(mo.trust)],
    ['自營商', yi(w.dealer), yi(mo.dealer)],
  ]
  return (
    <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      <div>
        <p className="font-medium text-gray-800 dark:text-gray-200">
          台股三大法人買賣超 <span className="text-xs font-normal text-gray-600 dark:text-gray-400">（至 {data.flows.at(-1)?.date ?? '—'}）</span>
        </p>
        <table className="mt-1 w-full text-right text-gray-700 dark:text-gray-300">
          <thead className="text-xs text-gray-600 dark:text-gray-400">
            <tr>
              <th className="py-1 text-left font-medium"></th>
              <th className="py-1 font-medium">近 5 日</th>
              <th className="py-1 font-medium">近 20 日</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, a, b]) => (
              <tr key={name} className="border-t border-gray-100 dark:border-gray-700">
                <td className="py-1 text-left">{name}</td>
                <td className="py-1">{a}</td>
                <td className="py-1">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 text-gray-700 dark:text-gray-300">
        {data.breadth && (
          <p>
            <span className="font-medium text-gray-800 dark:text-gray-200">上市股票漲跌家數</span>（{data.breadth.date}）：上漲 {num.format(data.breadth.up)}、下跌{' '}
            {num.format(data.breadth.down)}、持平 {num.format(data.breadth.unchanged)}
          </p>
        )}
        {margin && (
          <p>
            <span className="font-medium text-gray-800 dark:text-gray-200">融資餘額</span>（{margin.date}）：{num.format(Math.round(margin.balance / 1e8))} 億
            {margin.changePct !== null && `，近 20 日 ${signedPct(margin.changePct)}`}
          </p>
        )}
        {m.usBreadth && (
          <p>
            <span className="font-medium text-gray-800 dark:text-gray-200">美股廣度 RSP ÷ SPY</span>（{m.usBreadth.date}）：{m.usBreadth.ratio}，
            {m.usBreadth.above ? '在 60 日均線之上（多數股票參與）' : '在 60 日均線之下（漲勢集中在權值股）'}
          </p>
        )}
      </div>
    </div>
  )
}

function SourcesTable({ m }: { m: DailyMarket }) {
  const data = m.data!
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-gray-600 dark:text-gray-300">
        資料來源與驗證（更新於 {new Date(data.generatedAt).toLocaleString('zh-TW')}）
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs text-gray-700 dark:text-gray-300">
          <thead className="text-gray-600 dark:text-gray-400">
            <tr>
              <th className="py-1 pr-3 font-medium">指數</th>
              <th className="py-1 pr-3 font-medium">資料日期</th>
              <th className="py-1 pr-3 font-medium">驗證來源</th>
              <th className="py-1 pr-3 font-medium">狀態</th>
              <th className="py-1 font-medium">說明</th>
            </tr>
          </thead>
          <tbody>
            {INDEX_DEFS.map((d) => {
              const r = data.reliability[d.key]
              return (
                <tr key={d.key} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-1 pr-3">{d.name}</td>
                  <td className="py-1 pr-3">{data.series[d.key]?.at(-1)?.date ?? '—'}</td>
                  <td className="py-1 pr-3">FinMind{d.check ? `＋${d.check}` : ''}</td>
                  <td className="py-1 pr-3">{r && <Badge tone={RELIABILITY_TONE[r.status]}>{r.label}</Badge>}</td>
                  <td className="py-1">{r?.detail}</td>
                </tr>
              )
            })}
            <tr className="border-t border-gray-100 dark:border-gray-700">
              <td className="py-1 pr-3">{FUTURES_NAME}（日盤＋夜盤）</td>
              <td className="py-1 pr-3">
                {data.futures.at(-1) ? `${data.futures.at(-1)!.date} ${data.futures.at(-1)!.session === 'night' ? '夜盤' : '日盤'}` : '—'}
              </td>
              <td className="py-1 pr-3">FinMind＋期交所</td>
              <td className="py-1 pr-3">
                <Badge tone={RELIABILITY_TONE[data.futuresReliability.status]}>{data.futuresReliability.label}</Badge>
              </td>
              <td className="py-1">{data.futuresReliability.detail}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          每天由 GitHub 自動抓取並與官方來源比對（台股 14:30；美股與台指期夜盤在收盤後的 07:00），差異超過 0.5% 時改用官方數字。網頁開啟時若有更新的收盤，會再向 FinMind 補抓。全部是免費公開資料，不需要金鑰。
        </p>
        {data.errors.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-red-600 dark:text-red-400">
            {data.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

export function DailyMarketPanel() {
  const m = useDailyMarket()
  const [selected, setSelected] = useState<ChartKey>('TAIEX')

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">每日大盤走勢</h2>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/handbook/05" className="text-indigo-700 hover:underline dark:text-indigo-400">
            判讀規則（05 §6）
          </Link>
          <button
            type="button"
            disabled={m.loading}
            onClick={m.refresh}
            className="rounded-md border border-indigo-600 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
          >
            {m.loading ? '讀取中…' : '重新整理'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        依固定規則判讀趨勢與風險，不預測漲跌。核心部位不因每日走勢調整；交易部位參考 200 日線。
      </p>

      {!m.data && m.loading && <p className="py-8 text-center text-sm text-gray-500">正在讀取指數資料…</p>}
      {m.data && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MarketColumn market="TW" m={m} selected={selected} onSelect={setSelected} />
            <MarketColumn market="US" m={m} selected={selected} onSelect={setSelected} />
          </div>
          <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            {selected === 'FUTURES' ? (
              <FuturesChart bars={m.data.futures} taiex={m.data.series.TAIEX ?? []} />
            ) : (
              <IndexChart name={indexDef(selected).name} points={m.data.series[selected] ?? []} />
            )}
          </div>
          <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <FlowsTable m={m} />
          </div>
          <SourcesTable m={m} />
        </>
      )}
    </section>
  )
}
