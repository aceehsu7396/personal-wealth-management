import { useAppStore } from '../../lib/storage/appStore'
import { useRegimeReview } from '../../lib/useRegimeReview'
import { REGIME_LABELS, REGIME_TONE } from '../../lib/market/regime'
import { REVIEW_RULES, VERDICT_LABELS, type SegmentReview, type Verdict } from '../../lib/calculations/regimeReview'
import { Badge, Card, DataTable, type Tone } from '../ui'

const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)
const VERDICT_TONE: Record<Verdict, Tone> = { right: 'good', wrong: 'bad', unclear: 'warn', unscored: 'info', pending: 'info' }

// The regime rules in hindsight (blueprint 02 §6.1), with the scenario sets
// written during each regime beside them.
export function RegimeReview() {
  const review = useRegimeReview()
  const sets = useAppStore((s) => s.scenarioSets)
  if (!review) return <Card title="局勢判斷回顧"><p className="text-sm text-gray-600 dark:text-gray-400">正在讀取加權指數…</p></Card>
  const rows = [...review.rows].reverse()
  const setsIn = (r: SegmentReview) => sets.filter((s) => s.date >= r.segment.start && s.date <= r.segment.end)
  return (
    <Card
      title="局勢判斷回顧"
      description={`防守型局勢（修正、空頭、崩跌）之後 3 個月下跌算正確、上漲超過 ${REVIEW_RULES.missBy}% 算錯誤；進攻型局勢反之；盤整不計分。結果只當作年度檢討的依據，門檻不會自動調整。`}
    >
      <p className="text-sm text-gray-800 dark:text-gray-200">
        近 4 年 {review.rows.length} 段局勢，計分 {review.scored} 段，命中率 <span className="font-semibold">{review.hitRate === null ? '—' : `${Math.round(review.hitRate * 100)}%`}</span>。
        「過晚」：確立時距高點已跌超過 {-REVIEW_RULES.lateDrawdown}%；「來回」：不到 {REVIEW_RULES.whipsawSessions} 個交易日就轉換。
      </p>
      <div className="mt-3">
        <DataTable<SegmentReview>
          rows={rows}
          rowKey={(r) => r.segment.start}
          columns={[
            { key: 'regime', label: '局勢', render: (r) => <Badge tone={REGIME_TONE[r.segment.regime]}>{REGIME_LABELS[r.segment.regime]}</Badge> },
            { key: 'span', label: '期間', render: (r) => `${r.segment.start} – ${r.segment.end}`, sortValue: (r) => r.segment.start },
            { key: 'm3', label: '之後 3 個月', numeric: true, render: (r) => signed(r.segment.after.m3), sortValue: (r) => r.segment.after.m3 ?? -Infinity },
            {
              key: 'verdict',
              label: '判定',
              render: (r) => (
                <span className="flex flex-wrap gap-1">
                  <Badge tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABELS[r.verdict]}</Badge>
                  {r.late && <Badge tone="warn">過晚</Badge>}
                  {r.whipsaw && <Badge tone="info">來回</Badge>}
                </span>
              ),
            },
            {
              key: 'sets',
              label: '當時的推演',
              render: (r) => {
                const list = setsIn(r)
                return list.length === 0 ? <span className="text-xs text-gray-600 dark:text-gray-400">—</span> : <span className="text-xs">{list.map((s) => s.question).join('；')}</span>
              },
            },
          ]}
        />
      </div>
    </Card>
  )
}
