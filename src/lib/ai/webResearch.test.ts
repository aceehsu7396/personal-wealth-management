import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { collectSources, runWebResearch, type ResearchClient } from './webResearch'
import { estimateCostUsd, ResearchRefusedError } from './client'

type BetaMessage = Anthropic.Beta.Messages.BetaMessage

function message(overrides: Omit<Partial<BetaMessage>, 'content'> & { content: unknown[] }): BetaMessage {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 500, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
    ...overrides,
  } as unknown as BetaMessage
}

const cited = (text: string, url: string) => ({
  type: 'text',
  text,
  citations: [{ type: 'web_search_result_location', url, title: `T ${url}`, cited_text: 'x', encrypted_index: 'e' }],
})

function fakeClient(responses: BetaMessage[]): ResearchClient & { calls: unknown[] } {
  const calls: unknown[] = []
  const create = vi.fn(async (params: unknown) => {
    calls.push(structuredClone(params))
    return responses.shift()!
  })
  return { beta: { messages: { create } }, calls } as unknown as ResearchClient & { calls: unknown[] }
}

describe('runWebResearch', () => {
  it('sends the web tools, model and fallback, and returns cited text', async () => {
    const client = fakeClient([message({ content: [cited('# 報告\n', 'https://a.tw'), { type: 'text', text: '結論' }] })])
    const result = await runWebResearch({ prompt: 'p' }, client)
    expect(result.markdown).toBe('# 報告\n結論')
    expect(result.sources).toEqual([{ title: 'T https://a.tw', url: 'https://a.tw' }])
    expect(result.searchCount).toBe(2)
    const params = client.calls[0] as Record<string, unknown>
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.fallbacks).toBe('default')
    expect((params.tools as { type: string }[]).map((t) => t.type)).toEqual([
      'web_search_20260209',
      'web_fetch_20260209',
    ])
  })

  it('resumes a paused turn by sending the assistant content back', async () => {
    const paused = message({ stop_reason: 'pause_turn', content: [{ type: 'text', text: '第一段' }] })
    const done = message({ content: [{ type: 'text', text: '第二段' }] })
    const client = fakeClient([paused, done])
    const result = await runWebResearch({ prompt: 'p' }, client)
    expect(result.markdown).toBe('第一段第二段')
    const second = client.calls[1] as { messages: { role: string }[] }
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.estimatedCostUsd).toBeCloseTo(2 * estimateCostUsd(done.usage))
  })

  it('stops after the continuation cap and marks the result truncated', async () => {
    const paused = () => message({ stop_reason: 'pause_turn', content: [{ type: 'text', text: '.' }] })
    const client = fakeClient(Array.from({ length: 10 }, paused))
    const result = await runWebResearch({ prompt: 'p' }, client)
    expect(client.calls).toHaveLength(6)
    expect(result.truncated).toBe(true)
  })

  it('throws a readable error on refusal', async () => {
    const client = fakeClient([message({ stop_reason: 'refusal', content: [] })])
    await expect(runWebResearch({ prompt: 'p' }, client)).rejects.toBeInstanceOf(ResearchRefusedError)
  })

  it('throws when no text came back', async () => {
    const client = fakeClient([
      message({ content: [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } }] }),
    ])
    await expect(runWebResearch({ prompt: 'p' }, client)).rejects.toThrow('沒有取得研究內容')
  })
})

describe('collectSources', () => {
  it('dedupes citations and falls back to search results', () => {
    const withCitations = message({ content: [cited('a', 'https://x'), cited('b', 'https://x')] })
    expect(collectSources([withCitations])).toHaveLength(1)
    const searchOnly = message({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://y', title: 'Y' }] },
        { type: 'text', text: 'no citations' },
      ],
    })
    expect(collectSources([searchOnly])).toEqual([{ title: 'Y', url: 'https://y' }])
  })
})

describe('estimateCostUsd', () => {
  it('prices tokens and searches', () => {
    expect(
      estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 10 } }),
    ).toBeCloseTo(4 + 2 + 0.1)
  })
})
