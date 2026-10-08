import { describe, expect, it, vi } from 'vitest'
import { fetchTwseValuations, parseOptionalNumber, parseValuationResponse } from './twseValuation'

const FIELDS = ['證券代號', '證券名稱', '收盤價', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季']

describe('parseOptionalNumber', () => {
  it('handles separators, dashes and blanks', () => {
    expect(parseOptionalNumber('2,585.00')).toBe(2585)
    expect(parseOptionalNumber('-')).toBeNull()
    expect(parseOptionalNumber('')).toBeNull()
    expect(parseOptionalNumber(114)).toBe(114)
  })
})

describe('parseValuationResponse', () => {
  it('maps rows by column name', () => {
    const result = parseValuationResponse(
      {
        stat: 'OK',
        fields: FIELDS,
        data: [
          ['2330', '台積電', '2,585.00', '0.85', 114, '29.96', '10.42', '115/2'],
          ['2002', '中鋼', '20.10', '-', 113, '-', '0.95', '115/2'],
        ],
      },
      '2026-10-07',
    )!
    expect(result['2330']).toEqual({
      ticker: '2330',
      name: '台積電',
      close: 2585,
      dividendYield: 0.85,
      pe: 29.96,
      pb: 10.42,
      period: '115/2',
      date: '2026-10-07',
    })
    expect(result['2002'].pe).toBeNull()
  })

  it('returns null for non-trading days', () => {
    expect(parseValuationResponse({ stat: '很抱歉，沒有符合條件的資料!' }, '2026-10-04')).toBeNull()
  })
})

describe('fetchTwseValuations', () => {
  it('walks back to the most recent trading day', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const date = new URL(url).searchParams.get('date')
      const body =
        date === '20261002'
          ? { stat: 'OK', fields: FIELDS, data: [['2330', '台積電', '1', '1', 1, '1', '1', '1']] }
          : { stat: 'NO DATA' }
      return new Response(JSON.stringify(body))
    })
    const result = await fetchTwseValuations(new Date(2026, 9, 4), fetchImpl as unknown as typeof fetch)
    expect(result?.date).toBe('2026-10-02')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
