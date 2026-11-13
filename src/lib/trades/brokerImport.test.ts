import { describe, expect, it } from 'vitest'
import { decode, detectColumns, markDuplicates, missingFields, nameResolver, parseCsv, parseDate, parseSide, readRows, readStatement, statementRows } from './brokerImport'
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

// Reconstructed from Fubon statements (2026-10): a TW cash table with names
// only, and a US regular savings table with an English second header.
const FUBON_PASTE = [
  '我的交割資料明細',
  '有價證券買賣現股:\t單位:新台幣元',
  '交易日期\t交割日期\t交易類別\t證券名稱\t交易單位/台錢\t成交股數/台股\t成交價格\t成交金額\t手續費\t交易稅\t債息\t債息稅款\t客戶應收金額\t客戶應付金額',
  '115/10/15\t115/10/15\t普買定期定額\t元大台灣50\t\t182\t109.4500\t19,919\t2\t0\t\t\t0\t19,921',
  '本期合計\t\t\t\t\t\t\t19,919\t2\t0\t\t\t0\t19,921',
  '股票定期定額成交記錄 Transactions of Stock Regular Savings Plan',
  '交易日期\t市場\t證券代號\t證券名稱\t買賣別\t成交股數\t成交價格\t成交金額\t手續費\t交易稅\t應收付金額\t實際應收付金額\t實際匯率\t交割日期',
  'Transaction Date\tStock Exchange\tTicker\tSecurity Name\tTransaction Type\tNumber of Shares Transacted\tTransaction Price\tTransaction Amount\tCommission\tTransaction Tax\tAccounts Receivable/Payable\tActual\tActual Exchange Rate\tSettlement Date',
  '115/10/19\tARCA\tVOO\tVOO\t買進\t0.12965\t705.340000\t91.45\t0.0900\t0.0000\tUSD -91.54\tTWD -2,982.00\t32.568000\t115/10/20',
  '小計\t\t\t\t\t\t\t\t\t\tUSD -91.54\t0.00\t0.000000',
].join('\n')

describe('Fubon statements', () => {
  const resolve = nameResolver([{ code: '0050', name: '元大台灣50' }])

  it('reads both tables of a pasted statement', () => {
    const r = readStatement(statementRows(FUBON_PASTE), resolve)
    expect(r.tables).toBe(2)
    expect(r.skipped).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ date: '2026-10-15', ticker: '0050', name: '元大台灣50', side: 'buy', shares: 182, price: 109.45, fee: 2, currency: 'TWD', dca: true })
    expect(r.rows[1]).toMatchObject({ date: '2026-10-19', ticker: 'VOO', side: 'buy', shares: 0.12965, price: 705.34, fee: 0.09, currency: 'USD', dca: true })
  })

  it('reads the same tables saved as HTML', () => {
    const html = `<html><body><p>有價證券買賣現股:</p><table>
      <tr><th>交易日期</th><th>交割日期</th><th>交易類別</th><th>證券名稱</th><th>交易單位/<br>台錢</th><th>成交股數/<br>台股</th><th>成交<br>價格</th><th>成交<br>金額</th><th>手續費</th><th>交易稅</th></tr>
      <tr><td>115/10/15</td><td>115/10/15</td><td>普買定期定額</td><td>元大台灣50</td><td>&nbsp;</td><td>182</td><td>109.4500</td><td>19,919</td><td>2</td><td>0</td></tr>
      <tr><td colspan="7">本期合計</td><td>19,919</td><td>2</td><td>0</td></tr></table></body></html>`
    const r = readStatement(statementRows(html), resolve)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ ticker: '0050', shares: 182, price: 109.45 })
  })

  it('keeps a name it cannot match, for the trader to fill in', () => {
    const r = readStatement(statementRows(FUBON_PASTE.replace('元大台灣50', '某某基金')), resolve)
    expect(r.rows[0]).toMatchObject({ ticker: '', name: '某某基金' })
    expect(nameResolver([{ code: '2330', name: '台積電' }])('臺積電')).toBe('2330')
  })
})
