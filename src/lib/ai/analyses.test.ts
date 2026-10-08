import { describe, expect, it } from 'vitest'
import {
  buildIndustryPrompt,
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

describe('prompts', () => {
  it('name the subject, market and date', () => {
    expect(buildIndustryPrompt('半導體', 'TW', '2026-10-08')).toContain('台灣市場：半導體產業')
    const stock = buildStockPrompt('NVDA', 'NVIDIA', 'US', '2026-10-08')
    expect(stock).toContain('美國股票 NVDA NVIDIA')
    expect(stock).toContain('反方觀點')
  })
})
