import { Link } from 'react-router-dom'
import { useRegime } from '../../lib/market/useRegime'
import { ADD_ON_LABELS, REGIME_LABELS, REGIME_RULE_LIST, REGIME_TONE, REGIME_RULES, type Facet, type RegimeSegment } from '../../lib/market/regime'
import { ENTRY_METHOD_LABELS } from '../../lib/trades/tradePlan'
import { Badge, Card, DataTable, Disclosure, textLink, type Tone } from '../ui'

const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)
const scoreTone = (s: number): Tone => (s > 0 ? 'good' : s < 0 ? 'bad' : 'info')

function FacetRow({ facet }: { facet: Facet }) {
  return (
    <li className="flex items-start gap-3 py-1.5">
      <span className="w-24 shrink-0 text-sm text-gray-700 dark:text-gray-300">{facet.label}</span>
      <span className="w-10 shrink-0">
        {facet.score === null ? (
          <Badge tone="info">—</Badge>
        ) : (
          <Badge tone={scoreTone(facet.score)}>
            {facet.score > 0 ? '+' : ''}
            {facet.score}
          </Badge>
        )}
      </span>
      <span className="text-xs text-gray-600 dark:text-gray-400">{facet.basis}</span>
    </li>
  )
}

// The regime and the parameter row it applies (blueprint 02 §1.1, §3.9):
// conclusion on the left, the basis on the right.
export function RegimeCard() {
  const { ctx, history, facets, loading } = useRegime()
  if (!ctx || !history) {
    return (
      <Card title="局勢狀態">
        <p className="text-sm text-gray-600 dark:text-gray-400">{loading ? '正在讀取加權指數…' : '加權指數資料不足 200 個交易日，無法判斷局勢。'}</p>
      </Card>
    )
  }
  const row = ctx.row
  const segments = [...history.segments].reverse()
  return (
    <Card title="局勢狀態" description="依加權指數的固定規則判斷，連續 3 個交易日才算確立；局勢決定計畫單套用局勢參數表的哪一列。">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{ctx.label}</span>
            <Badge tone={REGIME_TONE[ctx.regime]}>{ctx.since} 起</Badge>
          </div>
          {ctx.pending && (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
              最新一天的讀數是「{REGIME_LABELS[ctx.pending]}」，再連續 {REGIME_RULES.confirmSessions} 個交易日才會轉換。
            </p>
          )}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-600 dark:text-gray-400">部位倍數</dt>
            <dd className="font-medium text-gray-900 dark:text-gray-100">
              {ctx.multiplier}
              {ctx.macroHalved && <span className="ml-2 text-xs font-normal text-gray-600 dark:text-gray-400">（總經強烈逆風，{row.sizeMultiplier} 減半）</span>}
            </dd>
            <dt className="text-gray-600 dark:text-gray-400">允許的進場</dt>
            <dd className="text-gray-900 dark:text-gray-100">{row.allowedEntries.length > 0 && ctx.multiplier > 0 ? row.allowedEntries.map((m) => ENTRY_METHOD_LABELS[m]).join('、') : '暫停新建倉'}</dd>
            <dt className="text-gray-600 dark:text-gray-400">初始停損</dt>
            <dd className="text-gray-900 dark:text-gray-100">{row.stopAtr} × ATR</dd>
            <dt className="text-gray-600 dark:text-gray-400">加碼</dt>
            <dd className="text-gray-900 dark:text-gray-100">{ADD_ON_LABELS[row.addOn]}</dd>
            <dt className="text-gray-600 dark:text-gray-400">獲利了結</dt>
            <dd className="text-gray-900 dark:text-gray-100">{row.takeProfit}</dd>
            <dt className="text-gray-600 dark:text-gray-400">核心部位</dt>
            <dd className="text-gray-900 dark:text-gray-100">{row.core}</dd>
          </dl>
          <p className="mt-4">
            <Link to="/goals#regime-params" className={textLink}>
              看局勢參數表
            </Link>
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">依據：各面向分數（−2 到 +2）</h3>
          <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
            {facets.map((f) => (
              <FacetRow key={f.key} facet={f} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">面向分數只當依據，不改變局勢；總經只會讓部位更保守。估值、信用、利率需要新的資料來源，之後補上。</p>
          <Disclosure summary="判斷規則（依序比對，先符合的採用）">
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-gray-700 dark:text-gray-300">
              {REGIME_RULE_LIST.map((r) => (
                <li key={r.key}>
                  <span className="font-medium">{r.label}</span>：{r.rule}
                </li>
              ))}
            </ol>
          </Disclosure>
          <Disclosure summary={`局勢歷史（${segments.length} 段，之後 1、3、6 個月的漲跌）`}>
            <div className="mt-2">
              <DataTable<RegimeSegment>
                rows={segments}
                rowKey={(s) => s.start}
                limit={6}
                columns={[
                  { key: 'regime', label: '局勢', render: (s) => <Badge tone={REGIME_TONE[s.regime]}>{REGIME_LABELS[s.regime]}</Badge> },
                  { key: 'span', label: '期間', render: (s) => `${s.start} – ${s.end}`, sortValue: (s) => s.start },
                  { key: 'm1', label: '1 個月', numeric: true, render: (s) => signed(s.after.m1), sortValue: (s) => s.after.m1 ?? -Infinity },
                  { key: 'm3', label: '3 個月', numeric: true, render: (s) => signed(s.after.m3), sortValue: (s) => s.after.m3 ?? -Infinity },
                  { key: 'm6', label: '6 個月', numeric: true, render: (s) => signed(s.after.m6), sortValue: (s) => s.after.m6 ?? -Infinity },
                ]}
              />
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">只用來檢查規則是否合理，不拿來事後調整門檻。</p>
            </div>
          </Disclosure>
        </div>
      </div>
    </Card>
  )
}
