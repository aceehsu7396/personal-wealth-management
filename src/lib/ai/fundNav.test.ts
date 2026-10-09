import { describe, expect, it } from 'vitest'
import { buildFundNavPrompt, matchNavResults } from './fundNav'
import type { Holding } from '../storage/schema'

const fund = (ticker: string, currency: Holding['currency'] = 'USD'): Holding => ({
  id: ticker,
  kind: 'fund',
  ticker,
  name: `基金 ${ticker}`,
  sleeve: 'satellite_fund',
  currency,
  shares: 10,
  avgCost: 10,
  currentPrice: 10,
  provider: '基富通',
  createdAt: '',
})

describe('matchNavResults', () => {
  it('matches by fund code case-insensitively and checks currency', () => {
    const rows = matchNavResults(
      [fund('ab12'), fund('CD34', 'TWD'), fund('EF56')],
      [
        { ticker: 'AB12', nav: 12.34, navDate: '2026-10-08', currency: 'USD', note: '基金公司官網' },
        { ticker: 'CD34', nav: 15.2, navDate: '2026-10-08', currency: 'USD', note: '美元級別' },
        { ticker: 'EF56', nav: null, navDate: '', currency: 'USD', note: '找不到' },
      ],
    )
    expect(rows[0]).toMatchObject({ nav: 12.34, applicable: true, reason: null })
    expect(rows[1]).toMatchObject({ nav: 15.2, applicable: false })
    expect(rows[1].reason).toContain('幣別')
    expect(rows[2]).toMatchObject({ nav: null, applicable: false, note: '找不到' })
  })

  it('marks funds missing from the results', () => {
    expect(matchNavResults([fund('ZZ')], [])[0]).toMatchObject({ applicable: false, reason: '未取得淨值' })
  })
})

describe('buildFundNavPrompt', () => {
  it('lists every fund with code, provider and currency', () => {
    const prompt = buildFundNavPrompt([fund('AB12'), fund('CD34', 'TWD')], '2026-10-09')
    expect(prompt).toContain('代碼 AB12')
    expect(prompt).toContain('基富通')
    expect(prompt).toContain('計價幣別 新台幣')
  })
})
