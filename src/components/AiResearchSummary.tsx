import { useState } from 'react'
import Anthropic from '@anthropic-ai/sdk'
import { Link } from 'react-router-dom'
import { generateMarketResearchSummary, MissingApiKeyError } from '../lib/ai/researchSummary'
import type { DailyClose, MarketCheckIn } from '../lib/storage/schema'
import { getApiKey } from '../lib/ai/apiKeyStorage'

interface Props {
  taiex: DailyClose[]
  tw0050: DailyClose[]
  latestCheckIn?: MarketCheckIn
}

function describeError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return error.message
  if (error instanceof Anthropic.AuthenticationError) return 'API 金鑰無效，請至設定頁確認。'
  if (error instanceof Anthropic.RateLimitError) return '已達 API 速率限制，請稍後再試。'
  if (error instanceof Anthropic.APIError) return `AI 服務發生錯誤：${error.message}`
  if (error instanceof Error) return error.message
  return '發生未知錯誤，請稍後再試。'
}

export function AiResearchSummary({ taiex, tw0050, latestCheckIn }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [summary, setSummary] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const hasApiKey = Boolean(getApiKey())

  async function handleGenerate() {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const text = await generateMarketResearchSummary({ taiex, tw0050, latestCheckIn })
      setSummary(text)
      setStatus('idle')
    } catch (error) {
      setErrorMessage(describeError(error))
      setStatus('error')
    }
  }

  if (!hasApiKey) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        設定{' '}
        <Link to="/settings" className="font-medium text-emerald-700 underline dark:text-emerald-400">
          Anthropic API 金鑰
        </Link>{' '}
        後，可產生大盤與 0050 的 AI 研究摘要，輔助你判斷估值區間。
      </p>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={status === 'loading'}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {status === 'loading' ? '產生中…' : '產生研究摘要'}
      </button>

      {status === 'error' && errorMessage && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
      )}

      {summary && status !== 'error' && (
        <div className="mt-4 space-y-2">
          <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
            {summary}
          </p>
          <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
            此摘要由 AI 依歷史收盤價自動產生，僅供研究參考，非投資建議，請自行判斷。
          </p>
        </div>
      )}
    </div>
  )
}
