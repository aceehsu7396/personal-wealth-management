// The three advice levels (docs/ui-guidelines.md §6).
export type AdviceLevel = 'required' | 'suggest' | 'notice'

export interface Advice {
  level: AdviceLevel
  text: React.ReactNode
  // The rule or data behind it, e.g. "投資政策：每筆風險 1%".
  basis: React.ReactNode
}

export const ADVICE_LABELS: Record<AdviceLevel, string> = { required: '紀律要求', suggest: '建議', notice: '提醒' }
