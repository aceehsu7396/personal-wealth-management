import type { CoachInput, EventMonitorInput, PlanInput, RedTeamInput, RegimeInput, ReviewerInput } from '../agents'

// Fixed inputs for the prompt evals: taken from the demo data and from edge
// cases (no data, a pause in force, a crash regime). Each case names the
// facts its prompt must carry.

export interface EvalCase<T> {
  name: string
  input: T
  mustInclude: string[]
}

export const EVENT_CASES: EvalCase<EventMonitorInput>[] = [
  {
    name: '停損觸發排在最前',
    input: {
      today: '2026-11-12',
      regime: { label: '修正', since: '2026-11-10', multiplier: 0.5 },
      items: [
        { level: '紀律要求', text: '2330 台積電 收盤 2,180 跌破停損 2,200：依計畫出場', basis: '出場規則：停損優先' },
        { level: '提醒', text: '006208 富邦台50：11/17 除息', basis: '事件日曆（證交所）' },
      ],
    },
    mustInclude: ['跌破停損 2,200', '修正', '11/17 除息', '紀律要求'],
  },
  { name: '沒有資料', input: { today: '2026-11-12', regime: null, items: [] }, mustInclude: ['資料未載入', '（沒有資料）'] },
  {
    name: '暫停中',
    input: {
      today: '2026-11-12',
      regime: { label: '崩跌與流動性危機', since: '2026-11-05', multiplier: 0 },
      items: [{ level: '紀律要求', text: '連續虧損 3 筆：交易部位暫停新建倉，先完成暫停檢討', basis: '投資政策：連續虧損 3 筆就暫停' }],
    },
    mustInclude: ['暫停新建倉', '部位倍數 0'],
  },
]

export const PLAN_CASES: EvalCase<PlanInput>[] = [
  {
    name: '示範計畫單，含金額',
    input: {
      plan: { ticker: '2330', name: '台積電', status: '草稿', method: '價值區間分批', setup: '研究卡結論「值得投資」', trigger: '收盤 ≤ 960', confirmation: '局勢不是危機', entry: 958, stop: 885, shares: 86, targets: '1600 出 1/3、1920 出清', exit: '連兩季營收衰退', regime: '修正・部位倍數 0.5' },
      advice: [
        { level: '紀律要求', text: '股數 173 超過局勢上限 86 股', basis: '局勢參數：修正，部位倍數 0.5' },
        { level: '建議', text: '風報比只有 1.6，低於 2', basis: '第一個停利點、停損', decision: '不採納：以訊號出場' },
      ],
      sizing: ['固定風險：300 股', '目標波動度：187 股（最保守，採用）', '停損時虧損 NT$62,780'],
    },
    mustInclude: ['初始停損：885', '超過局勢上限 86 股', '風報比只有 1.6', '每股風險 73.00'],
  },
]

export const REGIME_CASES: EvalCase<RegimeInput>[] = [
  {
    name: '崩跌、讀數轉為修正',
    input: {
      regime: { label: '崩跌與流動性危機', since: '2026-11-05', pending: '修正', multiplier: 0, allowed: '暫停新建倉', stopAtr: 2.5, addOn: '不加碼' },
      rule: '20 個交易日跌超過 15%',
      facets: [
        { label: '趨勢', score: -1, basis: '多頭排列中收盤跌破 60 日線' },
        { label: '估值', score: null, basis: '歷史不足一年，不計分' },
      ],
      history: [{ label: '多頭過熱', start: '2026-10-29', end: '2026-11-04', m3: null }],
    },
    mustInclude: ['崩跌與流動性危機', '確認期還沒過', '部位倍數 0', '無資料', '還不知道'],
  },
]

export const RED_TEAM_CASES: EvalCase<RedTeamInput>[] = [
  { name: '決策', input: { kind: 'decision', title: '股票比例下調 5 個百分點', lines: ['判斷：未來半年波動加大', '信心：60%', '事前驗屍：低估 AI 需求'] }, mustInclude: ['股票比例下調 5 個百分點', '信心：60%', '如果發生就代表我錯了'] },
]

export const COACH_CASES: EvalCase<CoachInput>[] = [
  {
    name: '樣本少',
    input: { groups: [{ by: '進場方法', key: '突破', count: 2, winRate: 0.5, expectancy: 0.3, enough: false }], execution: ['有計畫單的買進 1／4 筆', '停損延遲 0 次'], pauses: ['2026-10-08 連續 3 筆暫停並檢討'] },
    mustInclude: ['樣本太少', '樣本少於 5 筆', '停損延遲 0 次', '連續 3 筆暫停'],
  },
]

export const REVIEWER_CASES: EvalCase<ReviewerInput>[] = [
  {
    name: '示範年度報告',
    input: { markdown: '# 2026 年度檢討報告\n\n## 2 報酬\n\n- 時間加權：44.2%\n- 淨資產：NT$8,209,533\n\n## 6 修訂建議\n\n- 今年觸發暫停 1 次：回顧暫停檢討的共同原因' },
    mustInclude: ['時間加權：44.2%', '今年觸發暫停 1 次', '不要新增修訂建議'],
  },
]
