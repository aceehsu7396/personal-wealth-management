import type { Trade } from '../storage/schema'

// Broker statement import (handbook 04 §6). Fubon's statements are web
// pages with several tables (TW cash trades, US regular savings, …): they
// can be saved as HTML, copied and pasted (tab-separated) or exported as
// CSV. Columns are found by name, with aliases for other brokers' wording;
// the TW table has no ticker, so names are looked up. When nothing can be
// recognised the caller asks the trader to map the columns. Imported trades
// are marked as such and never pass as checked.

export type ImportField = 'date' | 'ticker' | 'name' | 'side' | 'shares' | 'lots' | 'price' | 'fee' | 'tax' | 'market'

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
  market: '市場',
}

const ALIASES: Record<ImportField, string[]> = {
  date: ['成交日期', '交易日期', '成交日', '日期'],
  ticker: ['股票代號', '證券代號', '股票代碼', '商品代號', '代號'],
  name: ['股票名稱', '證券名稱', '商品名稱', '名稱'],
  side: ['買賣別', '交易類別', '交易別', '買/賣', '買賣'],
  shares: ['成交股數', '成交股數/台股', '股數', '成交數量', '數量'],
  lots: ['成交張數', '張數'],
  price: ['成交價', '成交單價', '成交價格', '單價', '價格'],
  fee: ['手續費'],
  tax: ['交易稅', '證交稅'],
  market: ['市場', '交易市場'],
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

// The columns a row names, if it is a trade table's header: a date, a
// ticker or name, and a price.
export function headerMapping(row: string[]): Mapping | null {
  const cells = row.map(norm)
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
  const named = mapping.ticker !== undefined || mapping.name !== undefined
  return mapping.date !== undefined && named && mapping.price !== undefined ? mapping : null
}

// The first header row and its columns, for the manual mapping screen.
export function detectColumns(rows: string[][]): { headerRow: number; mapping: Mapping } | null {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const mapping = headerMapping(rows[r])
    if (mapping) return { headerRow: r, mapping }
  }
  return null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" }
const text = (h: string) => h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&(\w+|#\d+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m)).replace(/\s+/g, ' ').trim()

// Every table row of an HTML statement, tables one after another; a
// table's caption-like first cell stays as a one-cell row.
export function htmlRows(html: string): string[][] {
  const rows: string[][] = []
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).flatMap((c) => {
      const span = Number(c.match(/colspan\s*=\s*"?(\d+)/i)?.[1] ?? 1)
      return [text(c), ...Array<string>(Math.max(0, span - 1)).fill('')]
    })
    if (cells.some((c) => c !== '')) rows.push(cells)
  }
  return rows
}

// A statement as rows of cells: HTML, tab-separated (copied from a web
// page) or CSV.
export function statementRows(content: string): string[][] {
  if (/<table/i.test(content)) return htmlRows(content)
  if (content.includes('\t')) return content.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))
  return parseCsv(content)
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
  // Empty when a name-only row could not be matched to a ticker.
  ticker: string
  name: string
  side: Trade['side']
  shares: number
  price: number
  fee?: number
  tax?: number
  margin: boolean
  currency: Trade['currency']
  // A regular savings plan buy (定期定額).
  dca: boolean
}

export interface ParseResult {
  rows: ImportRow[]
  // Data lines that could not be read, with the reason.
  skipped: { line: number; reason: string }[]
}

const US_MARKETS = /^(ARCA|NYSE|NASDAQ|AMEX|BATS|NYSEARCA|美國)/i
const nameKey = (s: string) => s.replace(/[\s　]/g, '').replace(/臺/g, '台').toUpperCase()

// Look up a ticker by security name (the TW table has names only).
export function nameResolver(entries: { code: string; name: string }[]): (name: string) => string {
  const byName = new Map(entries.map((e) => [nameKey(e.name), e.code]))
  return (name) => byName.get(nameKey(name)) ?? ''
}

// One data row under a header; null when the row is not a trade (totals,
// a second header in English, notes).
function readRow(cells: string[], m: Mapping, line: number, resolve: (name: string) => string, context: { dca: boolean }): ImportRow | { line: number; reason: string } | null {
  const cell = (f: ImportField) => (m[f] === undefined ? undefined : cells[m[f]!])
  const rawDate = cell('date') ?? ''
  if (!/\d/.test(rawDate)) return null
  const date = parseDate(rawDate)
  const sideText = cell('side') ?? ''
  const side = parseSide(sideText)
  const name = cell('name') ?? ''
  // Codes such as 00679B keep their letter; quotes and '=' from Excel go.
  const ticker = (cell('ticker') ?? '').replace(/[="'\s]/g, '').toUpperCase() || resolve(name)
  const lots = num(cell('lots'))
  const shares = num(cell('shares')) ?? (lots !== null ? lots * 1000 : null)
  const price = num(cell('price'))
  if (!date) return { line, reason: '日期看不懂' }
  if (!side) return { line, reason: '買賣別看不懂' }
  if (!shares || shares <= 0 || !price || price <= 0) return { line, reason: '股數或價格不正確' }
  if (!ticker && !name) return { line, reason: '缺代號與名稱' }
  const us = US_MARKETS.test(cell('market') ?? '')
  return { line, date, ticker, name, side: side.side, shares, price, fee: num(cell('fee')) ?? undefined, tax: num(cell('tax')) ?? undefined, margin: side.margin, currency: us ? 'USD' : 'TWD', dca: context.dca || sideText.includes('定期定額') }
}

// Rows under one known header (manual mapping).
export function readRows(rows: string[][], headerRow: number, m: Mapping, resolve: (name: string) => string = () => ''): ParseResult {
  const out: ImportRow[] = []
  const skipped: ParseResult['skipped'] = []
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = readRow(rows[r], m, r + 1, resolve, { dca: false })
    if (!row) continue
    if ('date' in row) out.push(row)
    else skipped.push(row)
  }
  return { rows: out, skipped }
}

// A whole statement: every trade table, each under its own header. A
// one-cell title row containing 定期定額 marks the next table as savings
// plan buys.
export function readStatement(rows: string[][], resolve: (name: string) => string = () => ''): ParseResult & { tables: number } {
  const out: ImportRow[] = []
  const skipped: ParseResult['skipped'] = []
  let mapping: Mapping | null = null
  let tables = 0
  const context = { dca: false }
  rows.forEach((cells, r) => {
    const filled = cells.filter((c) => c !== '')
    const header = headerMapping(cells)
    if (header) {
      mapping = header
      tables++
      return
    }
    if (filled.length <= 2 && filled.join('').length > 3 && !/\d{3}\/\d/.test(filled.join(''))) {
      // A title between tables: a new table starts after it.
      context.dca = filled.join('').includes('定期定額')
      return
    }
    if (!mapping) return
    const row = readRow(cells, mapping, r + 1, resolve, context)
    if (!row) return
    if ('date' in row) out.push(row)
    else skipped.push(row)
  })
  return { rows: out, skipped, tables }
}

// Same date, ticker, side, shares and price: already in the trade log.
export const tradeKey = (t: Pick<Trade, 'date' | 'ticker' | 'side' | 'shares' | 'price'>) => `${t.date}|${t.ticker}|${t.side}|${t.shares}|${t.price}`

export function markDuplicates(rows: ImportRow[], existing: Trade[]): Set<number> {
  const seen = new Set(existing.map(tradeKey))
  return new Set(rows.filter((r) => seen.has(tradeKey(r))).map((r) => r.line))
}

export const IMPORTED_CHECKLIST = [{ key: 'imported', label: '券商對帳單事後匯入，未逐項檢核', passed: true }]
