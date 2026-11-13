import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { todayIsoDate } from '../../lib/market/twse'
import { DecisionKindSchema, type Decision, type DecisionKind } from '../../lib/storage/schema'
import { Field, inputClass } from '../forms/FormField'
import { Badge, Card, DataTable, secondaryButton } from '../ui'
import { DECISION_KIND_LABELS } from './labels'
import { redTeamPrompt } from '../../lib/ai/prompts/agents'
import { PromptPanel } from '../ai/PromptPanel'

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

type Draft = Omit<Decision, 'id'>

function blank(search: URLSearchParams): Draft {
  const kind = DecisionKindSchema.safeParse(search.get('kind')).data ?? 'other'
  const today = todayIsoDate()
  return { date: today, kind, title: search.get('title') ?? '', judgment: '', reasons: search.get('reasons') ?? '', confidence: 60, premortem: '', reviewDate: addMonths(today, 6) }
}

function ReviewForm({ decision, onDone }: { decision: Decision; onDone: () => void }) {
  const update = useAppStore((s) => s.updateDecision)
  const [outcome, setOutcome] = useState('')
  const [quality, setQuality] = useState(3)
  const [lesson, setLesson] = useState('')
  return (
    <div className="mt-3 space-y-3 rounded-md bg-gray-50 p-3 dark:bg-gray-900/40">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        當時的事前驗屍：{decision.premortem || '（沒寫）'}
      </p>
      <Field label="實際結果">
        <textarea rows={2} className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="決定的品質（1 到 5，看過程不看運氣）">
          <select className={inputClass} value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="心得">
          <input className={inputClass} value={lesson} onChange={(e) => setLesson(e.target.value)} />
        </Field>
      </div>
      <button
        type="button"
        className={secondaryButton}
        disabled={!outcome.trim()}
        onClick={() => {
          update(decision.id, { outcome: outcome.trim(), quality, lesson: lesson.trim(), reviewedAt: todayIsoDate() })
          onDone()
        }}
      >
        回填
      </button>
    </div>
  )
}

// Non-trade decisions with a pre-mortem, filled in after the review date
// (handbook 04 §5). Trades are recorded on trade plans instead.
export function DecisionJournal() {
  const decisions = useAppStore((s) => s.decisions)
  const add = useAppStore((s) => s.addDecision)
  const [search, setSearch] = useSearchParams()
  const [draft, setDraft] = useState<Draft | null>(() => (search.get('decision') === 'new' ? blank(search) : null))
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayIsoDate()
  const rows = [...decisions].sort((a, b) => b.date.localeCompare(a.date))
  const due = rows.filter((d) => !d.reviewedAt && d.reviewDate <= today)

  const save = () => {
    if (!draft) return
    if (!draft.title.trim() || !draft.judgment.trim() || !draft.premortem.trim()) return setError('標題、判斷與事前驗屍都要寫。')
    add({ ...draft, title: draft.title.trim() })
    setDraft(null)
    setError(null)
    if (search.get('decision')) setSearch({ tab: 'decisions' }, { replace: true })
  }

  return (
    <Card
      title="決策日誌"
      description="戰術傾斜、修改局勢參數或投資政策這類決定，事前寫下判斷、信心與事前驗屍，到期回填結果。交易本身記在計畫單。"
      action={
        draft ? undefined : (
          <button type="button" className={secondaryButton} onClick={() => setDraft(blank(new URLSearchParams()))}>
            新增決策
          </button>
        )
      }
    >
      {draft && (
        <div className="mb-6 space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-700">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="類型">
              <select className={inputClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DecisionKind })}>
                {DecisionKindSchema.options.map((k) => (
                  <option key={k} value={k}>
                    {DECISION_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="標題">
              <input className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例：股票比例下調 5 個百分點" />
            </Field>
          </div>
          <Field label="判斷：我認為會發生什麼">
            <textarea rows={2} className={inputClass} value={draft.judgment} onChange={(e) => setDraft({ ...draft, judgment: e.target.value })} />
          </Field>
          <Field label="理由與依據">
            <textarea rows={2} className={inputClass} value={draft.reasons} onChange={(e) => setDraft({ ...draft, reasons: e.target.value })} />
          </Field>
          <Field label="事前驗屍：假設一年後結果很差，最可能的原因是什麼">
            <textarea rows={2} className={inputClass} value={draft.premortem} onChange={(e) => setDraft({ ...draft, premortem: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:w-96">
            <Field label="信心（%）">
              <input type="number" min="0" max="100" step="5" className={inputClass} value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: Number(e.target.value) })} />
            </Field>
            <Field label="檢討日">
              <input type="date" className={inputClass} value={draft.reviewDate} onChange={(e) => setDraft({ ...draft, reviewDate: e.target.value })} />
            </Field>
          </div>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" className={secondaryButton} onClick={save}>
              儲存決策
            </button>
            <button type="button" className="text-sm text-gray-600 hover:underline dark:text-gray-400" onClick={() => setDraft(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {due.length > 0 && <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">{due.length} 筆決策已到檢討日，請回填結果。</p>}
      <DataTable<Decision>
        rows={rows}
        rowKey={(d) => d.id}
        empty="還沒有決策紀錄。"
        columns={[
          { key: 'date', label: '日期', render: (d) => d.date, sortValue: (d) => d.date },
          { key: 'kind', label: '類型', render: (d) => DECISION_KIND_LABELS[d.kind] },
          {
            key: 'title',
            label: '決策',
            render: (d) => (
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">{d.title}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{d.judgment}</p>
                {d.reviewedAt && <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">結果：{d.outcome}{d.lesson ? `；心得：${d.lesson}` : ''}</p>}
                {reviewing === d.id && <ReviewForm decision={d} onDone={() => setReviewing(null)} />}
                {!d.reviewedAt && (
                  <div className="mt-1">
                    <PromptPanel
                      label="AI 唱反調"
                      build={() =>
                        redTeamPrompt({
                          kind: 'decision',
                          title: d.title,
                          lines: [`類型：${DECISION_KIND_LABELS[d.kind]}`, `判斷：${d.judgment}`, `理由：${d.reasons}`, `信心：${d.confidence}%`, `事前驗屍：${d.premortem}`, `檢討日：${d.reviewDate}`],
                        })
                      }
                    />
                  </div>
                )}
              </div>
            ),
          },
          { key: 'conf', label: '信心', numeric: true, render: (d) => `${d.confidence}%`, sortValue: (d) => d.confidence },
          {
            key: 'state',
            label: '狀態',
            render: (d) =>
              d.reviewedAt ? (
                <Badge tone="good">已回填・{d.quality}／5</Badge>
              ) : d.reviewDate <= today ? (
                <button type="button" className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-400" onClick={() => setReviewing(reviewing === d.id ? null : d.id)}>
                  回填結果
                </button>
              ) : (
                <span className="text-xs text-gray-600 dark:text-gray-400">{d.reviewDate} 檢討</span>
              ),
          },
        ]}
      />
    </Card>
  )
}
