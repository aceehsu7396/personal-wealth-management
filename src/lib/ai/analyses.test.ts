import { describe, expect, it, vi } from 'vitest'
import {
  analyzeStock,
  applyKnownQuote,
  mergeStockFacts,
  missingStockFields,
  buildIndustryPrompt,
  buildMarketPrompt,
  MACRO_PRIMARY_SOURCE,
  buildStockPrompt,
  macroDraftToForm,
  MacroDraftSchema,
  stockFactsToDraft,
  type MacroDraft,
  type StockFacts,
} from './analyses'

const t = (value: 'up' | 'flat' | 'down') => ({ value, reason: `理由 ${value}` })
const s = (value: '1' | '0' | '-1') => ({ value, reason: `理由 ${value}` })

const draft: MacroDraft = {
  growth: { usPmi: t('up'), usEmployment: t('flat'), twBusinessSignal: t('up'), twExportOrders: t('down') },
  inflation: { usCpi: t('down'), twCpi: t('flat') },
  liquidity: {
    policyRate: s('1'),
    yieldCurve: s('0'),
    creditSpread: s('-1'),
    centralBankBalanceSheet: s('0'),
    usDollar: s('1'),
  },
  sentiment: { valuation: s('1'), credit: s('0'), ipoHype: s('0'), media: s('0'), margin: s('-1'), vix: s('0') },
  policyNote: '聯準會降息',
}

describe('macroDraftToForm', () => {
  it('converts signals to numbers and keeps a reason per field', () => {
    expect(MacroDraftSchema.safeParse(draft).success).toBe(true)
    const { values, reasons } = macroDraftToForm(draft, '2026-10-08')
    expect(values.date).toBe('2026-10-08')
    expect(values.growth.usPmi).toBe('up')
    expect(values.liquidity.creditSpread).toBe(-1)
    expect(values.sentiment.valuation).toBe(1)
    expect(values.policyNote).toBe('聯準會降息')
    expect(reasons['liquidity.policyRate']).toBe('理由 1')
    expect(Object.keys(reasons)).toHaveLength(17)
  })
})

describe('stockFactsToDraft', () => {
  const facts: StockFacts = {
    name: '台積電',
    sector: '半導體',
    currency: 'TWD',
    currentPrice: 1000,
    priceDate: '2026-10-07',
    roicPercent: 25,
    historicalGrowthPercent: null,
    growthBasis: '',
    fScore: 8,
    fScoreItems: [],
    redFlags: '未發現',
  }

  it('pre-fills only factual fields and leaves missing ones undefined', () => {
    expect(stockFactsToDraft(facts)).toEqual({
      name: '台積電',
      sector: '半導體',
      currentPrice: 1000,
      roicPercent: 25,
      historicalGrowthPercent: undefined,
      fScore: 8,
    })
  })

  it('drops an out-of-range F score', () => {
    expect(stockFactsToDraft({ ...facts, fScore: 12 }).fScore).toBeUndefined()
  })
})

describe('market prompt', () => {
  it('reads the Fubon outlook first and searches only to fill gaps', () => {
    const prompt = buildMarketPrompt('2026-10-11')
    expect(prompt).toContain(MACRO_PRIMARY_SOURCE)
    expect(prompt).toContain('富邦總經觀點-○月市場展望')
    expect(prompt.indexOf(MACRO_PRIMARY_SOURCE)).toBeLessThan(prompt.indexOf('上網搜尋補充'))
  })
})

describe('prompts', () => {
  it('name the subject, market and date', () => {
    expect(buildIndustryPrompt('半導體', 'TW', '2026-10-08')).toContain('台灣市場：半導體產業')
    const stock = buildStockPrompt('NVDA', 'NVIDIA', 'US', '2026-10-08')
    expect(stock).toContain('美國股票 NVDA NVIDIA')
    expect(stock).toContain('反方觀點')
  })
})

describe('stock follow-up search', () => {
  const blank: StockFacts = {
    name: '',
    sector: '',
    currency: 'TWD',
    currentPrice: null,
    priceDate: '',
    roicPercent: null,
    historicalGrowthPercent: null,
    growthBasis: '',
    fScore: null,
    fScoreItems: [],
    redFlags: '未發現',
  }
  const full: StockFacts = {
    ...blank,
    name: '台積電',
    currentPrice: 1000,
    priceDate: '2026-10-08',
    roicPercent: 25,
    historicalGrowthPercent: 18,
    growthBasis: '營收 CAGR',
    fScore: 8,
    fScoreItems: [{ item: 'ROA > 0', passed: true, note: '' }],
  }

  it('lists missing key figures', () => {
    expect(missingStockFields(blank)).toEqual(['currentPrice', 'roicPercent', 'historicalGrowthPercent', 'fScore'])
    expect(missingStockFields(full)).toEqual([])
  })

  it('fills only gaps and keeps each value with its context', () => {
    const merged = mergeStockFacts({ ...full, roicPercent: null, fScore: null, fScoreItems: [] }, {
      ...full,
      currentPrice: 1,
      roicPercent: 30,
      fScore: 7,
      fScoreItems: [{ item: 'x', passed: false, note: '' }],
    })
    expect(merged.currentPrice).toBe(1000)
    expect(merged.roicPercent).toBe(30)
    expect(merged.fScore).toBe(7)
    expect(merged.fScoreItems[0].item).toBe('x')
  })

  it('uses the TWSE close when the report has no price', () => {
    const known = { price: 990, pe: 25, pb: 7, dividendYield: 1.2, date: '2026-10-08' }
    expect(applyKnownQuote(blank, known)).toMatchObject({ currentPrice: 990, priceDate: '2026-10-08' })
    expect(applyKnownQuote(full, known).currentPrice).toBe(1000)
  })

  it('asks for numbers first and passes known TWSE data', () => {
    const prompt = buildStockPrompt('2330', '台積電', 'TW', '2026-10-09', {
      price: 990, pe: 25, pb: null, dividendYield: 1.2, date: '2026-10-08',
    })
    expect(prompt).toContain('先取得財務數字')
    expect(prompt).toContain('收盤價 990、本益比 25、殖利率 1.2%')
    expect(prompt).not.toContain('股價淨值比 null')
  })

  function clients(extractions: StockFacts[]) {
    const prompts: string[] = []
    const usage = { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } }
    const research = {
      beta: {
        messages: {
          create: vi.fn(async (params: { messages: { content: string }[]; tools: { max_uses: number }[] }) => {
            prompts.push(`${params.messages[0].content} [max ${params.tools[0].max_uses}]`)
            return {
              stop_reason: 'end_turn',
              usage,
              content: [{ type: 'text', text: prompts.length === 1 ? '# 報告' : '## 補查：財務數據', citations: null }],
            }
          }),
        },
      },
    }
    const extraction = {
      beta: { messages: { parse: vi.fn(async () => ({ stop_reason: 'end_turn', usage, parsed_output: extractions.shift() })) } },
    }
    return { prompts, clients: { research, extraction } as unknown as Parameters<typeof analyzeStock>[4] }
  }

  it('runs one focused follow-up when two or more key figures are missing', async () => {
    const { prompts, clients: c } = clients([
      { ...full, roicPercent: null, fScore: null, fScoreItems: [] },
      { ...blank, roicPercent: 24, fScore: 7 },
    ])
    const result = await analyzeStock('2330', '台積電', 'TW', '2026-10-09', c)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('只查這些數字')
    expect(prompts[1]).toContain('投入資本報酬率')
    expect(prompts[1]).not.toContain('過去 5 年營收')
    expect(prompts[1]).toContain('[max 6]')
    expect(result.followUp).toBe(true)
    expect(result.facts).toMatchObject({ roicPercent: 24, fScore: 7, currentPrice: 1000 })
    expect(result.stillMissing).toEqual([])
    expect(result.research.markdown).toContain('## 補查：財務數據')
  })

  it('skips the follow-up when at most one figure is missing, and reports it', async () => {
    const { prompts, clients: c } = clients([{ ...full, fScore: null }])
    const result = await analyzeStock('2330', '台積電', 'TW', '2026-10-09', c)
    expect(prompts).toHaveLength(1)
    expect(result.followUp).toBe(false)
    expect(result.stillMissing).toEqual(['fScore'])
    expect(result.research.markdown.startsWith('> **以下數據本次未取得**')).toBe(true)
  })

  it('notes figures still missing after the follow-up', async () => {
    const { clients: c } = clients([blank, blank])
    const result = await analyzeStock('2330', '台積電', 'TW', '2026-10-09', c)
    expect(result.followUp).toBe(true)
    expect(result.stillMissing).toHaveLength(4)
    expect(result.research.markdown).toContain('補查後仍未取得')
  })
})
