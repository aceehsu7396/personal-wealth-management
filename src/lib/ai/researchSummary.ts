import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from './apiKeyStorage'
import type { DailyClose, MarketCheckIn } from '../storage/schema'

export class MissingApiKeyError extends Error {
  constructor() {
    super('尚未設定 Anthropic API 金鑰')
    this.name = 'MissingApiKeyError'
  }
}

const VALUATION_ZONE_LABELS: Record<string, string> = {
  undervalued: '低估',
  fair: '合理',
  overvalued: '高估',
  extremely_overvalued: '極度高估',
  unsure: '不確定',
}

const MARKET_PHASE_LABELS: Record<string, string> = {
  bull_early: '牛市初期',
  bull_late: '牛市末端',
  bear: '空頭市場',
  recovery: '回升初期',
  sideways: '盤整',
  unsure: '不確定',
}

function summarizeSeries(label: string, data: DailyClose[], windowSize = 15): string {
  const recent = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(-windowSize)
  if (recent.length === 0) return `${label}：無資料`

  const first = recent[0]
  const last = recent[recent.length - 1]
  const closes = recent.map((p) => p.close)
  const high = Math.max(...closes)
  const low = Math.min(...closes)
  const changePercent = ((last.close - first.close) / first.close) * 100

  const points = recent.map((p) => `${p.date}: ${p.close}`).join('、')

  return [
    `${label}（近 ${recent.length} 個交易日）`,
    `區間：${first.date} 至 ${last.date}，收盤 ${first.close} → ${last.close}（${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%）`,
    `期間高點 ${high}、低點 ${low}`,
    `逐日收盤：${points}`,
  ].join('\n')
}

export async function generateMarketResearchSummary(params: {
  taiex: DailyClose[]
  tw0050: DailyClose[]
  latestCheckIn?: MarketCheckIn
}): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new MissingApiKeyError()

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const checkInContext = params.latestCheckIn
    ? `使用者目前手動判斷：市場階段「${MARKET_PHASE_LABELS[params.latestCheckIn.marketPhase]}」、估值區間「${VALUATION_ZONE_LABELS[params.latestCheckIn.valuationZone]}」。`
    : '使用者尚未填寫市場評估。'

  const prompt = `你是一位協助個人長期投資者做研究筆記的助理。以下是台灣加權指數（大盤）與元大台灣50（0050）近期的收盤價資料：

${summarizeSeries('大盤（發行量加權股價指數）', params.taiex)}

${summarizeSeries('0050', params.tw0050)}

${checkInContext}

請用繁體中文寫一段約 150-250 字的研究摘要，內容包含：
1. 客觀描述近期價格走勢與波動特徵（不要加入你自己對未來走勢的預測）
2. 這段資料可以如何輔助使用者自行判斷目前估值區間（低估／合理／高估），但不要替使用者下結論
3. 明確聲明這只是資料層面的描述性摘要，不是進出場訊號、不是投資建議

不要使用條列式，用連貫的段落呈現。`

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('AI 無法針對這個請求產生摘要，請稍後再試。')
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  )
  return textBlock?.text ?? ''
}
