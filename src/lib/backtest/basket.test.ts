import { describe, expect, it } from 'vitest'
import type { StockRow } from '../screener/stockData'
import { downloadSeconds, downloadText, peerBasket, watchBasket } from './basket'

const stock = (code: string, industry: string, marketCap: number | null, isEtf = false) => ({ code, name: code, industry, isEtf, marketCap }) as StockRow

describe('baskets', () => {
  const stocks = [
    stock('2330', '半導體業', 500),
    stock('2454', '半導體業', 100),
    stock('2303', '半導體業', 50),
    stock('3711', '半導體業', null),
    stock('2882', '金融保險業', 60),
    stock('0050', 'ETF', null, true),
  ]

  it('adds the largest peers of the same industry', () => {
    expect(peerBasket('TW:2330', stocks)).toEqual({ label: '半導體業前 2 大', symbols: ['TW:2330', 'TW:2454', 'TW:2303'] })
    expect(peerBasket('TW:2882', stocks)).toBeNull()
    expect(peerBasket('TW:9999', stocks)).toBeNull()
  })

  it('pairs an ETF with the broad Taiwan ETFs', () => {
    expect(peerBasket('TW:0050', stocks)?.symbols).toEqual(['TW:0050', 'TW:006208', 'TW:0056', 'TW:00878', 'TW:00692'])
  })

  it('adds watched Taiwan stocks up to eight', () => {
    const watched = ['TW:2330', 'US:AAPL', ...Array.from({ length: 10 }, (_, i) => `TW:${1101 + i}`)]
    const b = watchBasket(['TW:2330'], watched)!
    expect(b).toHaveLength(8)
    expect(b[0]).toBe('TW:2330')
    expect(b).not.toContain('US:AAPL')
    expect(watchBasket(['TW:2330'], ['TW:2330'])).toBeNull()
  })

  it('estimates the download from what the cache lacks', () => {
    const none = downloadSeconds(['TW:2330'], '2021-11-20', '2026-11-20', () => [])
    // 15 warm-up months + 5 years ≈ 76 months and 7 years, 2 seconds each.
    expect(none).toBeGreaterThan(150)
    const all = downloadSeconds(['TW:2330'], '2021-11-20', '2026-11-20', () => Array.from({ length: 12 * 8 }, (_, i) => `${2019 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`))
    expect(all).toBeLessThan(10)
    expect(downloadText(all)).toBe('使用已下載的資料')
    expect(downloadText(none)).toContain('分鐘')
  })
})
