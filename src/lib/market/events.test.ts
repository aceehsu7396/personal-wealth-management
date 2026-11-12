import { describe, expect, it } from 'vitest'
import { conferenceDate, rocDate, ruleEvents, sessionsBetween, upcoming, type MarketEvent } from './events'

describe('event calendar', () => {
  it('reads 民國 dates in both formats', () => {
    expect(rocDate('1151113')).toBe('2026-11-13')
    expect(rocDate('115/11/23')).toBe('2026-11-23')
    expect(rocDate('115/1/5')).toBe('2026-01-05')
    expect(rocDate('abc')).toBeNull()
  })

  it('finds the conference date in a material-information notice', () => {
    expect(conferenceDate('公告本公司召開法人說明會', '1.召開法人說明會之日期：115/11/23 | 2.時間')).toBe('2026-11-23')
    expect(conferenceDate('澄清媒體報導', '法人說明會之日期：115/11/23')).toBeNull()
  })

  it('moves statutory deadlines past weekends and adds bank meetings', () => {
    const e = ruleEvents('2026-11-01', '2026-12-31')
    // 2026-11-14 is a Saturday: the Q3 deadline moves to Monday.
    expect(e.find((x) => x.kind === 'quarterly')?.date).toBe('2026-11-16')
    expect(e.find((x) => x.kind === 'revenue')?.date).toBe('2026-11-10')
    expect(e.some((x) => x.kind === 'fomc' && x.date === '2026-12-09')).toBe(true)
    expect(e.some((x) => x.kind === 'cbc' && x.date === '2026-12-17')).toBe(true)
  })

  it('keeps events within the trading days asked, for held tickers', () => {
    expect(sessionsBetween('2026-11-13', '2026-11-17')).toBe(2)
    const ev: MarketEvent[] = [
      { date: '2026-11-17', kind: 'exdiv', ticker: '2330', title: '除息', source: '' },
      { date: '2026-11-17', kind: 'exdiv', ticker: '2317', title: '除息', source: '' },
      { date: '2026-11-30', kind: 'conference', ticker: '2330', title: '法說', source: '' },
      { date: '2026-11-16', kind: 'quarterly', title: 'Q3', source: '' },
    ]
    expect(upcoming(ev, '2026-11-13', 3, new Set(['2330'])).map((e) => e.ticker ?? e.kind)).toEqual(['quarterly', '2330'])
    expect(upcoming(ev, '2026-11-13', 3, new Set(['2330']), false)).toHaveLength(1)
  })
})
