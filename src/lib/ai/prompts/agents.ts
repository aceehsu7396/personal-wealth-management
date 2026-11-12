import { buildPrompt, type PromptSection } from './common'

// The six agents of blueprint 03, in its order. Each takes the rule layer's
// results as plain lines (already formatted by the page) and returns the
// prompt to paste into Claude.

const line = (label: string, value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? '' : `${label}：${value}`)

// 1 Event monitor: today's work, events and the regime.
export interface EventMonitorInput {
  today: string
  items: { level: string; text: string; basis: string }[]
  regime?: { label: string; since: string; multiplier: number } | null
  includeAmounts?: boolean
}

export function eventMonitorPrompt(x: EventMonitorInput): string {
  return buildPrompt({
    agent: '事件監控',
    task: `今天是 ${x.today}。下面是系統依紀律優先順序排出的「今天要處理的事」。請用三到五句話說明今天最重要的是什麼、為什麼排在前面，以及每一項依據的規則是什麼。`,
    questions: ['如果有「紀律要求」，先說明它，並提醒它是規則要求，不是建議。'],
    includeAmounts: x.includeAmounts,
    sections: [
      { title: '局勢', lines: x.regime ? [`${x.regime.label}（${x.regime.since} 起），新計畫單部位倍數 ${x.regime.multiplier}`] : ['資料未載入'] },
      { title: '今天要處理的事（依優先順序）', lines: x.items.map((i) => `［${i.level}］${i.text}（依據：${i.basis}）`) },
    ],
  })
}

// 2 Entry-exit assistant, AI layer: one trade plan.
export interface PlanInput {
  plan: { ticker: string; name: string; status: string; method: string; setup: string; trigger: string; confirmation: string; entry?: number; stop?: number; currentStop?: number; shares?: number; targets: string; exit: string; regime?: string }
  advice: { level: string; text: string; basis: string; decision?: string }[]
  sizing?: string[]
  includeAmounts?: boolean
}

function planSection(p: PlanInput['plan']): PromptSection {
  return {
    title: '計畫單',
    lines: [
      `${p.ticker} ${p.name}（${p.status}，進場方法：${p.method}）`,
      line('設定', p.setup),
      line('觸發', p.trigger),
      line('確認', p.confirmation),
      line('計畫進場價', p.entry),
      line('初始停損', p.stop),
      line('目前停損', p.currentStop),
      line('股數', p.shares),
      line('停利點', p.targets),
      line('論點失效與出場', p.exit),
      line('建立時的局勢', p.regime),
      p.entry && p.stop && p.entry > p.stop ? `每股風險 ${(p.entry - p.stop).toFixed(2)}（${(((p.entry - p.stop) / p.entry) * 100).toFixed(1)}%）` : '',
    ],
  }
}

export function planPrompt(x: PlanInput): string {
  return buildPrompt({
    agent: '進出場助手（說明）',
    task: '下面是一張交易計畫單，以及系統依紀律規則算出的三級建議。請說明：這張計畫的失效點在哪裡、風險有多大、每一條紀律要求與建議的意思和依據。',
    questions: ['如果有未通過的紀律要求，說明照規則現在不應下單的原因。'],
    includeAmounts: x.includeAmounts,
    sections: [
      planSection(x.plan),
      { title: '三級建議（紀律要求／建議／提醒）', lines: x.advice.map((a) => `［${a.level}］${a.text}（依據：${a.basis}）${a.decision ? `；我的選擇：${a.decision}` : ''}`) },
      { title: '部位大小三法', lines: x.sizing ?? [] },
    ],
  })
}

// 3 Regime interpretation.
export interface RegimeInput {
  regime: { label: string; since: string; pending?: string | null; multiplier: number; allowed: string; stopAtr: number; addOn: string }
  rule: string
  facets: { label: string; score: number | null; basis: string }[]
  history: { label: string; start: string; end: string; m3: number | null }[]
}

export function regimePrompt(x: RegimeInput): string {
  return buildPrompt({
    agent: '局勢解讀',
    task: '系統依固定規則判斷了目前的市場局勢，並列出各面向分數。請用白話說明：為什麼是這個局勢、哪些面向和局勢一致、哪些互相矛盾，以及這個局勢下的部位與進場限制是什麼意思。',
    questions: ['不要預測接下來會漲或跌；面向之間有矛盾時，指出矛盾即可。'],
    sections: [
      {
        title: '目前局勢',
        lines: [`${x.regime.label}（${x.regime.since} 起）${x.regime.pending ? `；最新一天的讀數是「${x.regime.pending}」，確認期還沒過` : ''}`, `判斷規則：${x.rule}`, `部位倍數 ${x.regime.multiplier}；允許的進場：${x.regime.allowed}；停損 ${x.regime.stopAtr} × ATR；加碼：${x.regime.addOn}`],
      },
      { title: '各面向分數（−2 到 +2，只當依據）', lines: x.facets.map((f) => `${f.label}：${f.score === null ? '無資料' : f.score > 0 ? `+${f.score}` : f.score}（${f.basis}）`) },
      { title: '最近幾段局勢與之後 3 個月的加權指數', lines: x.history.map((h) => `${h.label}：${h.start} 至 ${h.end}，之後 3 個月 ${h.m3 === null ? '還不知道' : `${h.m3 > 0 ? '+' : ''}${h.m3.toFixed(1)}%`}`) },
    ],
  })
}

// 4 Red team: argue against a plan or a decision.
export interface RedTeamInput {
  kind: 'plan' | 'decision'
  title: string
  lines: string[]
  includeAmounts?: boolean
}

export function redTeamPrompt(x: RedTeamInput): string {
  return buildPrompt({
    agent: '紅隊（唱反調）',
    task: `下面是我${x.kind === 'plan' ? '準備執行的一張交易計畫' : '做的一個決定'}。請扮演反方：找出最強的反對理由、最可能讓它失敗的路徑，以及我可能忽略的偏誤（例如確認偏誤、近因偏誤、過度自信）。`,
    questions: ['反對理由要能被資料檢驗；不要提出新的交易作為替代方案。', '最後列出 2 到 3 個「如果發生就代表我錯了」的具體訊號。'],
    includeAmounts: x.includeAmounts,
    sections: [{ title: x.title, lines: x.lines }],
  })
}

// 5 Trading coach: execution and R statistics.
export interface CoachInput {
  groups: { by: string; key: string; count: number; winRate: number; expectancy: number; enough: boolean }[]
  execution: string[]
  pauses: string[]
}

export function coachPrompt(x: CoachInput): string {
  return buildPrompt({
    agent: '交易教練',
    task: '下面是我交易部位的執行數據：依進場方法與局勢分組的 R 倍數、照計畫執行的程度、建議採納率與暫停紀錄。請指出執行上最值得改進的一件事，並說明依據。',
    questions: ['樣本少於 5 筆的分組不要下結論，只能說「還看不出來」。', '只談執行（是否照計畫、停損、部位），不評論個股或市場。'],
    sections: [
      { title: 'R 倍數分組', lines: x.groups.map((g) => `${g.by}「${g.key}」：${g.count} 筆、勝率 ${(g.winRate * 100).toFixed(0)}%、期望值 ${g.expectancy >= 0 ? '+' : ''}${g.expectancy.toFixed(2)}R${g.enough ? '' : '（樣本太少）'}`) },
      { title: '執行品質', lines: x.execution },
      { title: '暫停規則與檢討', lines: x.pauses },
    ],
  })
}

// 6 Reviewer: the yearly report.
export interface ReviewerInput {
  markdown: string
  includeAmounts?: boolean
}

export function reviewerPrompt(x: ReviewerInput): string {
  return buildPrompt({
    agent: '檢討員',
    task: '下面是系統產生的年度檢討報告，最後一段是由固定規則產生的修訂建議。請幫我檢查：報告裡的數字彼此一致嗎？每一條修訂建議的依據是什麼？有沒有數據其實不足以支持的建議？',
    questions: ['不要新增修訂建議；可以指出某條建議證據不足。'],
    includeAmounts: x.includeAmounts,
    sections: [{ title: '年度檢討報告', lines: x.markdown.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)) }],
  })
}
