import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { compileResearch, runWebResearch, type ResearchClient } from './webResearch'
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
    expect(result.markdown).toBe('# 報告\n ［1］結論')
    expect(result.sources).toEqual([
      { title: 'T https://a.tw', url: 'https://a.tw', kind: 'search', citedCount: 1 },
    ])
    expect(result.searchCount).toBe(2)
    const params = client.calls[0] as Record<string, unknown>
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.fallbacks).toBe('default')
    const tools = params.tools as { type: string; citations?: { enabled: boolean } }[]
    expect(tools.map((t) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209'])
    expect(tools[1].citations).toEqual({ enabled: true })
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

describe('compileResearch', () => {
  const fetched = (url: string, title: string) => ({
    type: 'web_fetch_tool_result',
    tool_use_id: 'f',
    content: { type: 'web_fetch_result', url, retrieved_at: null, content: { type: 'document', title, citations: null, source: {} } },
  })
  const pageCite = (title: string, index: number, start: number, end: number) => ({
    type: 'page_location', cited_text: 'x', document_index: index, document_title: title, file_id: null,
    start_page_number: start, end_page_number: end,
  })

  it('numbers fetched documents and marks cited pages inline', () => {
    const fubon = 'https://fblkeyin.moneydj.com/SaveFile/msgtable/outlook.pdf'
    const m = message({
      content: [
        fetched('https://invest.fubonlife.com.tw/list', '富邦金控研究報告'),
        fetched(fubon, '富邦總經觀點-9月市場展望'),
        { type: 'text', text: '美國 PMI 回升至 51', citations: [pageCite('富邦總經觀點-9月市場展望', 1, 3, 4)] },
        { type: 'text', text: '，VIX 15', citations: cited('', 'https://cboe.com').citations.map((c) => ({ ...c, title: 'Cboe' })) },
        { type: 'text', text: '。', citations: null },
      ],
    })
    const { markdown, sources } = compileResearch([m])
    expect(markdown).toBe('美國 PMI 回升至 51 ［2, p.3］，VIX 15 ［3］。')
    expect(sources).toEqual([
      { title: '富邦金控研究報告', url: 'https://invest.fubonlife.com.tw/list', kind: 'fetched', citedCount: 0 },
      { title: '富邦總經觀點-9月市場展望', url: fubon, kind: 'fetched', pages: [3], citedCount: 1 },
      { title: 'Cboe', url: 'https://cboe.com', kind: 'search', citedCount: 1 },
    ])
  })

  it('resolves documents by index when the title is missing and dedupes markers', () => {
    const m = message({
      content: [
        fetched('https://a/doc.pdf', 'A'),
        { type: 'text', text: '數據', citations: [pageCite('', 0, 2, 4), pageCite('', 0, 2, 3)] },
      ],
    })
    const { markdown, sources } = compileResearch([m])
    expect(markdown).toBe('數據 ［1, p.2］')
    expect(sources[0]).toMatchObject({ pages: [2, 3], citedCount: 2 })
  })

  it('falls back to search results when nothing was cited or fetched', () => {
    const searchOnly = message({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://y', title: 'Y' }] },
        { type: 'text', text: 'no citations' },
      ],
    })
    expect(compileResearch([searchOnly]).sources).toEqual([{ title: 'Y', url: 'https://y', kind: 'search', citedCount: 0 }])
  })
})

describe('estimateCostUsd', () => {
  it('prices tokens and searches', () => {
    expect(
      estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 10 } }),
    ).toBeCloseTo(4 + 2 + 0.1)
  })
})
