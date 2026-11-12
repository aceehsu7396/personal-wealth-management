// Prompt templates for the six AI agents of blueprint 03 (stage 6), used
// without an API key: the site builds the prompt from what the rules
// already computed, and the trader pastes it into their own Claude chat.
// The model may only explain those results; it never adds trades or
// changes rules.

export const PROMPT_LIMIT = 8000

export const GUARDRAILS = [
  '你的角色：只解釋下面「規則已經算出的結果」，幫我看懂依據與要注意的地方。',
  '不要提出新的買賣建議、目標價或進出場時機，也不要建議修改投資政策、局勢參數或計畫單；規則的修改只在我冷靜時自己決定。',
  '只根據下面提供的資料回答；資料不足以判斷時，直接說不知道，不要推測或補充外部資訊。',
  '用繁體中文回答，英文只放在括號裡當原名；句子短，先講結論再講依據。',
  '最後一段列出「需要你自己判斷的地方」。',
]

export interface PromptSection {
  title: string
  lines: string[]
}

export interface PromptSpec {
  agent: string
  task: string
  sections: PromptSection[]
  // Extra questions for this agent, after the standard rules.
  questions?: string[]
  includeAmounts?: boolean
}

// Hide NT$ amounts and long figures so the whole portfolio size is not
// pasted elsewhere; percentages, prices and R multiples stay.
export function redact(line: string): string {
  return line.replace(/NT\$\s?−?-?[\d,]+(\.\d+)?/g, '（金額已隱藏）').replace(/−?-?\d{1,3}(,\d{3}){2,}(\.\d+)?\s?元/g, '（金額已隱藏）')
}

export function buildPrompt(spec: PromptSpec): string {
  const clean = (l: string) => (spec.includeAmounts ? l : redact(l))
  const head = [`# ${spec.agent}`, '', spec.task, '', '## 規則', ...GUARDRAILS.map((g) => `- ${g}`), ...(spec.questions ?? []).map((q) => `- ${q}`), '']
  const body: string[] = []
  for (const s of spec.sections) {
    const lines = s.lines.filter((l) => l.trim() !== '')
    body.push(`## ${s.title}`, ...(lines.length ? lines.map((l) => `- ${clean(l)}`) : ['- （沒有資料）']), '')
  }
  let text = [...head, ...body].join('\n')
  // Keep the rules whole; trim the data from the end if it runs long.
  if (text.length > PROMPT_LIMIT) text = `${text.slice(0, PROMPT_LIMIT - 40)}\n…（資料過長，已截斷）\n`
  return text
}
