import { describe, expect, it } from 'vitest'
import { decode, detectColumns, markDuplicates, missingFields, parseCsv, parseDate, parseSide, readRows } from './brokerImport'
import type { Trade } from '../storage/schema'

const FUBON = [
  '富邦證券 成交明細',
  '成交日期,股票代號,股票名稱,買賣別,成交股數,成交價,手續費,交易稅,淨收付',
  '2026/11/03,2330,台積電,現買,"1,000",1050,1496,0,"-1,051,496"',
  '115/11/05,0050,元大台灣50,現賣,500,195.5,139,97,97514',
  '2026/11/06,2317,鴻海,融資買進,2000,210,598,0,-420598',
  '2026/11/07,="00679B",元大美債20年,現買,1000,27.5,39,0,-27539',
  '合計,,,,,,,,',
].join('\r\n')

describe('broker import', () => {
  it('decodes UTF-8 and Big5', () => {
    expect(decode(new TextEncoder().encode('﻿成交日期').buffer as ArrayBuffer)).toBe('成交日期')
    // "買" in Big5 is 0xB6 0x52.
    expect(decode(new Uint8Array([0xb6, 0x52]).buffer)).toBe('買')
  })

  it('finds the header below title lines and maps the columns', () => {
    const rows = parseCsv(FUBON)
    const d = detectColumns(rows)!
    expect(d.headerRow).toBe(1)
    expect(d.mapping).toMatchObject({ date: 0, ticker: 1, name: 2, side: 3, shares: 4, price: 5, fee: 6, tax: 7 })
    expect(missingFields(d.mapping)).toEqual([])
    expect(detectColumns([['a', 'b'], ['1', '2']])).toBeNull()
  })

  it('reads trades, dates in both calendars, sides and margin', () => {
    const rows = parseCsv(FUBON)
    const d = detectColumns(rows)!
    const r = readRows(rows, d.headerRow, d.mapping)
    expect(r.rows).toHaveLength(4)
    expect(r.rows[3].ticker).toBe('00679B')
    expect(r.rows[0]).toMatchObject({ date: '2026-11-03', ticker: '2330', side: 'buy', shares: 1000, price: 1050, fee: 1496, margin: false })
    expect(r.rows[1]).toMatchObject({ date: '2026-11-05', side: 'sell', tax: 97 })
    expect(r.rows[2].margin).toBe(true)
    expect(r.skipped).toEqual([])
  })

  it('parses the formats brokers use', () => {
    expect(parseDate('20261103')).toBe('2026-11-03')
    expect(parseDate('1151103')).toBe('2026-11-03')
    expect(parseDate('2026-1-3')).toBe('2026-01-03')
    expect(parseSide('S')?.side).toBe('sell')
    expect(parseSide('配股')).toBeNull()
  })

  it('marks trades already in the log', () => {
    const rows = readRows(parseCsv(FUBON), 1, detectColumns(parseCsv(FUBON))!.mapping).rows
    const existing = [{ date: '2026-11-03', ticker: '2330', side: 'buy', shares: 1000, price: 1050 } as Trade]
    expect([...markDuplicates(rows, existing)]).toEqual([3])
  })
})
