import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from './apiKeyStorage'

export const RESEARCH_MODEL = 'claude-opus-5-5'

// Server-side refusal fallback: if the model declines, the API re-runs the
// request on a fallback model chosen by refusal category.
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// Approximate list prices for the cost estimate shown with each report.
export const PRICE_PER_INPUT_TOKEN = 4 / 1_000_000
export const PRICE_PER_OUTPUT_TOKEN = 20 / 1_000_000
export const PRICE_PER_WEB_SEARCH = 10 / 1000

export class MissingApiKeyError extends Error {
  constructor() {
    super('尚未設定 Anthropic API 金鑰')
    this.name = 'MissingApiKeyError'
  }
}

export class ResearchRefusedError extends Error {
  constructor() {
    super('AI 無法針對這個請求產生內容，請調整主題後再試。')
    this.name = 'ResearchRefusedError'
  }
}

export function createClient(): Anthropic {
  const apiKey = getApiKey()
  if (!apiKey) throw new MissingApiKeyError()
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

export function describeAiError(error: unknown): string {
  if (error instanceof MissingApiKeyError || error instanceof ResearchRefusedError) return error.message
  if (error instanceof Anthropic.AuthenticationError) return 'API 金鑰無效，請至設定頁確認。'
  if (error instanceof Anthropic.RateLimitError) return '已達 API 速率限制，請稍後再試。'
  if (error instanceof Anthropic.APIError) return `AI 服務發生錯誤：${error.message}`
  if (error instanceof Error) return error.message
  return '發生未知錯誤，請稍後再試。'
}

export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: { web_search_requests: number } | null
}

export function estimateCostUsd(usage: UsageLike): number {
  const input =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
  const searches = usage.server_tool_use?.web_search_requests ?? 0
  return input * PRICE_PER_INPUT_TOKEN + usage.output_tokens * PRICE_PER_OUTPUT_TOKEN + searches * PRICE_PER_WEB_SEARCH
}
