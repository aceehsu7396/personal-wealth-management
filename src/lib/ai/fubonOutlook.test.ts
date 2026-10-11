import { describe, expect, it, vi } from 'vitest'
import { buildFubonDigestPrompt, digestFubonOutlook } from './fubonOutlook'
import { MACRO_PRIMARY_SOURCE } from './analyses'
import type { FubonOutlookContent } from '../storage/schema'

const content: FubonOutlookContent = {
  reportTitle: '富邦總經觀點-9月市場展望',
  reportDate: '2026-09-02',
  summary: '摘要',
  sections: [],
  allocation: [],
  forecasts: [{ index: 'taiex', low: 44000, high: 48000 }],
  actuals: [],
  coverage: [],
}

function clients(parsed: FubonOutlookContent) {
  const usage = { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 0, web_fetch_requests: 2 } }
  const create = vi.fn(async (_params: { tools: { max_uses: number }[] }) => ({
    stop_reason: 'end_turn',
    usage,
    content: [
      {
        type: 'web_fetch_tool_result',
        content: {
          type: 'web_fetch_result',
          url: 'https://fblkeyin.moneydj.com/SaveFile/msgtable/outlook.pdf',
          retrieved_at: null,
          content: { type: 'document', title: '富邦總經觀點-9月市場展望', citations: null, source: {} },
        },
      },
      { type: 'text', text: '## 1. 報告資訊', citations: null },
    ],
  }))
  return {
    create,
    clients: {
      research: { beta: { messages: { create } } },
      extraction: { beta: { messages: { parse: vi.fn(async () => ({ stop_reason: 'end_turn', usage, parsed_output: parsed })) } } },
    } as unknown as Parameters<typeof digestFubonOutlook>[1],
  }
}

describe('buildFubonDigestPrompt', () => {
  it('reads only the PDF and lists index and signal codes', () => {
    const prompt = buildFubonDigestPrompt('2026-10-11')
    expect(prompt).toContain(MACRO_PRIMARY_SOURCE)
    expect(prompt).toContain('只根據這份 PDF')
    expect(prompt).toContain('台股加權指數（taiex）')
    expect(prompt).toContain('恐慌指數 VIX（sentiment.vix）')
  })
})

describe('digestFubonOutlook', () => {
  it('returns the digest with the fetched PDF url and a small search budget', async () => {
    const { create, clients: c } = clients(content)
    const digest = await digestFubonOutlook('2026-10-11', c)
    expect(digest.pdfUrl).toBe('https://fblkeyin.moneydj.com/SaveFile/msgtable/outlook.pdf')
    expect(digest.forecasts).toHaveLength(1)
    expect(create.mock.calls[0][0].tools[0].max_uses).toBe(2)
  })

  it('fails clearly when the report could not be read', async () => {
    const { clients: c } = clients({ ...content, reportTitle: '' })
    await expect(digestFubonOutlook('2026-10-11', c)).rejects.toThrow('沒有讀取到富邦報告')
  })
})
