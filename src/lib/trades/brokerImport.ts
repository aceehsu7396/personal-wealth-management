import type { Trade } from '../storage/schema'

// Broker statement import (blueprint 02 §3.11): Fubon's trade-detail CSV
// read by column names, with aliases for the other wordings brokers use.
// When the columns cannot be recognised the caller asks the trader to map
// them. Imported trades are marked as such and never pass as checked.

export type ImportField = 'date' | 'ticker' | 'name' | 'side' | 'shares' | 'lots' | 'price' | 'fee' | 'tax'

export const FIELD_LABELS: Record<ImportField, string> = {
  date: '成交日期',
  ticker: '股票代號',
  name: '股票名稱',
  side: '買賣別',
  shares: '成交股數',
  lots: '成交張數',
  price: '成交價',
  fee: '手續費',
  tax: '交易稅',
}

const ALIASES: Record<ImportField, string[]> = {
  date: ['成交日期', '交易日期', '成交日', '日期'],
  ticker: ['股票代號', '證券代號', '股票代碼', '商品代號', '代號'],
  name: ['股票名稱', '證券名稱', '商品名稱', '名稱'],
  side: ['買賣別', '交易類別', '交易別', '買/賣', '買賣'],
  shares: ['成交股數', '股數', '成交數量', '數量'],
  lots: ['成交張數', '張數'],
  price: ['成交價', '成交單價', '成交價格', '單價', '價格'],
  fee: ['手續費'],
  tax: ['交易稅', '證交稅'],
}

export const REQUIRED: ImportField[] = ['date', 'ticker', 'side', 'price']

export type Mapping = Partial<Record<ImportField, number>>

// UTF-8 when it decodes cleanly, otherwise Big5 (Taiwan brokers' default).
export function decode(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('big5').decode(bytes)
  }
}

// RFC 4180-style CSV: quoted fields, doubled quotes, CRLF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell.trim())
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

const norm = (s: string) => s.replace(/[\s（）()]/g, '')

// The header row (the first that names a date and a ticker) and the column
// of each field it names.
export function detectColumns(rows: string[][]): { headerRow: number; mapping: Mapping } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(norm)
    const mapping: Mapping = {}
    for (const field of Object.keys(ALIASES) as ImportField[]) {
      for (const alias of ALIASES[field]) {
        const i = cells.findIndex((c, k) => c === alias && !Object.values(mapping).includes(k))
        if (i >= 0) {
          mapping[field] = i
          break
        }
      }
    }
    if (mapping.date !== undefined && mapping.ticker !== undefined) return { headerRow: r, mapping }
  }
  return null
}

export const missingFields = (m: Mapping): ImportField[] => {
  const need: ImportField[] = [...REQUIRED]
  if (m.shares === undefined && m.lots === undefined) need.push('shares')
  return need.filter((f) => m[f] === undefined)
}

// 2026/11/03, 2026-11-03, 20261103, 115/11/03 or 1151103 → 2026-11-03.
export function parseDate(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{2,3})[/-]?(\d{1,2})[/-]?(\d{1,2})$/)
  if (m && Number(m[1]) < 200) return `${Number(m[1]) + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

export function parseSide(s: string): { side: Trade['side']; margin: boolean } | null {
  const t = s.trim().toUpperCase()
  const margin = /融資|融券|資買|券賣|資賣|券買/.test(t)
  if (t.includes('買') || t === 'B' || t === 'BUY') return { side: 'buy', margin }
  if (t.includes('賣') || t === 'S' || t === 'SELL') return { side: 'sell', margin }
  return null
}

const num = (s: string | undefined) => {
  if (s === undefined) return null
  const v = Number(s.replace(/[,\s$]/g, ''))
  return Number.isFinite(v) ? v : null
}

export interface ImportRow {
  line: number
  date: string
  ticker: string
  name: string
  side: Trade['side']
  shares: number
  price: number
  fee?: number
  tax?: number
  margin: boolean
}

export interface ParseResult {
  rows: ImportRow[]
  // Data lines that could not be read, with the reason.
  skipped: { line: number; reason: string }[]
}

export function readRows(rows: string[][], headerRow: number, m: Mapping): ParseResult {
  const out: ImportRow[] = []
  const skipped: ParseResult['skipped'] = []
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cell = (f: ImportField) => (m[f] === undefined ? undefined : rows[r][m[f]!])
    const date = parseDate(cell('date') ?? '')
    const side = parseSide(cell('side') ?? '')
    // Codes such as 00679B keep their letter; quotes and '=' from Excel go.
    const ticker = (cell('ticker') ?? '').replace(/[="'\s]/g, '').toUpperCase()
    const lots = num(cell('lots'))
    const shares = num(cell('shares')) ?? (lots !== null ? lots * 1000 : null)
    const price = num(cell('price'))
    // Totals and notes at the end of a statement are not trades.
    if (!date && !ticker) continue
    if (!date || !side || !ticker || !shares || shares <= 0 || !price || price <= 0) {
      skipped.push({ line: r + 1, reason: !date ? '日期看不懂' : !side ? '買賣別看不懂' : !ticker ? '缺代號' : '股數或價格不正確' })
      continue
    }
    out.push({ line: r + 1, date, ticker, name: cell('name') ?? '', side: side.side, shares, price, fee: num(cell('fee')) ?? undefined, tax: num(cell('tax')) ?? undefined, margin: side.margin })
  }
  return { rows: out, skipped }
}

// Same date, ticker, side, shares and price: already in the trade log.
export const tradeKey = (t: Pick<Trade, 'date' | 'ticker' | 'side' | 'shares' | 'price'>) => `${t.date}|${t.ticker}|${t.side}|${t.shares}|${t.price}`

export function markDuplicates(rows: ImportRow[], existing: Trade[]): Set<number> {
  const seen = new Set(existing.map(tradeKey))
  return new Set(rows.filter((r) => seen.has(tradeKey(r))).map((r) => r.line))
}

export const IMPORTED_CHECKLIST = [{ key: 'imported', label: '券商對帳單事後匯入，未逐項檢核', passed: true }]
