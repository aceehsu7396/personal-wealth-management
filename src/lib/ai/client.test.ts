import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { describeAiError } from './client'

function apiError(status: number, message: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type: 'invalid_request_error', message } },
    undefined,
    new Headers(),
  )
}

describe('describeAiError', () => {
  it('explains an empty credit balance in Chinese with where to top up', () => {
    const msg = describeAiError(
      apiError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'),
    )
    expect(msg).toContain('額度不足')
    expect(msg).toContain('Billing')
  })

  it('keeps other bad requests as raw API messages', () => {
    expect(describeAiError(apiError(400, 'max_tokens too large'))).toContain('AI 服務發生錯誤')
  })

  it('maps auth, permission and server errors', () => {
    expect(describeAiError(apiError(401, 'invalid x-api-key'))).toContain('金鑰無效')
    expect(describeAiError(apiError(403, 'forbidden'))).toContain('權限')
    expect(describeAiError(apiError(529, 'Overloaded'))).toContain('稍後再試')
  })
})
