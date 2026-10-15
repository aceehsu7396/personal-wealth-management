import type { StockRow } from './stockData'

// Screening the listed universe: numeric ranges, industry and kind
// filters, a sort and an optional "top N%" cut. Built-in screens give a
// starting point for each style in handbook chapters 06, 07 and 10.

export type NumericField =
  | 'pe'
  | 'dividendYield'
  | 'pb'
  | 'revenueYoy'
  | 'revenueYtdYoy'
  | 'ret1m'
  | 'ret3m'
  | 'ret6m'
  | 'ret12m'
  | 'marketCap'
  | 'tradeValue'

export interface FieldDef {
  label: string
  unit: string
  // Shown as a percentage of a fraction (returns) rather than as-is.
  fraction?: boolean
  glossary?: string
}

export const FIELDS: Record<NumericField, FieldDef> = {
  pe: { label: '本益比', unit: '倍', glossary: '本益比' },
  dividendYield: { label: '殖利率', unit: '%', glossary: '殖利率' },
  pb: { label: '淨值比', unit: '倍', glossary: '淨值比' },
  revenueYoy: { label: '月營收年增', unit: '%', glossary: '營收年增率' },
  revenueYtdYoy: { label: '累計營收年增', unit: '%', glossary: '營收年增率' },
  ret1m: { label: '1 個月報酬', unit: '%', fraction: true, glossary: '動能' },
  ret3m: { label: '3 個月報酬', unit: '%', fraction: true, glossary: '動能' },
  ret6m: { label: '6 個月報酬', unit: '%', fraction: true, glossary: '動能' },
  ret12m: { label: '12 個月報酬', unit: '%', fraction: true, glossary: '動能' },
  marketCap: { label: '市值', unit: '億' },
  tradeValue: { label: '成交金額', unit: '億' },
}

// Bounds are in display units (returns in %, not fractions).
export interface RangeFilter {
  field: NumericField
  min?: number
  max?: number
}

export interface Screen {
  filters: RangeFilter[]
  kind: 'stock' | 'etf' | 'all'
  industry: string | null
  sortBy: NumericField
  sortDesc: boolean
  // Keep only the top share (e.g. 10 = top 10%) of the sorted result.
  topPercent?: number
  // Keep only the first N of the sorted result.
  topCount?: number
}

export interface PresetScreen {
  id: string
  name: string
  summary: string
  handbook: string
  screen: Screen
}

// Default liquidity floor: at least NT$50 million traded on the day.
export const LIQUIDITY_FLOOR: RangeFilter = { field: 'tradeValue', min: 0.5 }

export const PRESET_SCREENS: PresetScreen[] = [
  {
    id: 'value',
    name: '價值',
    summary: '本益比低、股價接近淨值、殖利率高：市場給的價格偏低，等待價值回歸。要確認不是因為衰退才便宜。',
    handbook: '07',
    screen: {
      filters: [{ field: 'pe', max: 15 }, { field: 'pb', max: 1.5 }, { field: 'dividendYield', min: 4 }, LIQUIDITY_FLOOR],
      kind: 'stock',
      industry: null,
      sortBy: 'dividendYield',
      sortDesc: true,
    },
  },
  {
    id: 'growth',
    name: '成長',
    summary: '營收大幅成長、今年累計也成長，且股價已開始反映：找基本面正在加速的公司。',
    handbook: '06',
    screen: {
      filters: [{ field: 'revenueYoy', min: 20 }, { field: 'revenueYtdYoy', min: 10 }, { field: 'ret6m', min: 0 }, LIQUIDITY_FLOOR],
      kind: 'stock',
      industry: null,
      sortBy: 'revenueYoy',
      sortDesc: true,
    },
  },
  {
    id: 'momentum',
    name: '動能',
    summary: '過去 12 個月漲最多的前 10%，排除近 1 個月崩跌的：強者恆強，搭配停損與每月調整。',
    handbook: '10',
    screen: {
      filters: [{ field: 'ret1m', min: -10 }, LIQUIDITY_FLOOR],
      kind: 'stock',
      industry: null,
      sortBy: 'ret12m',
      sortDesc: true,
      topPercent: 10,
    },
  },
  {
    id: 'income',
    name: '高股息品質',
    summary: '殖利率高、營收沒有衰退、本益比合理：避開「高息但本業在走下坡」的陷阱。',
    handbook: '07',
    screen: {
      filters: [{ field: 'dividendYield', min: 5 }, { field: 'revenueYoy', min: 0 }, { field: 'pe', max: 20 }, LIQUIDITY_FLOOR],
      kind: 'stock',
      industry: null,
      sortBy: 'dividendYield',
      sortDesc: true,
    },
  },
  {
    id: 'large',
    name: '大型權值',
    summary: '市值最大的 50 家公司：流動性好、資訊多，適合作為第一批研究對象。',
    handbook: '06',
    screen: { filters: [LIQUIDITY_FLOOR], kind: 'stock', industry: null, sortBy: 'marketCap', sortDesc: true, topCount: 50 },
  },
  {
    id: 'etf-momentum',
    name: 'ETF 動能',
    summary: '只看 ETF，依 6 個月報酬排序：動能輪動策略的候選清單。',
    handbook: '10',
    screen: { filters: [LIQUIDITY_FLOOR], kind: 'etf', industry: null, sortBy: 'ret6m', sortDesc: true },
  },
]

export function fieldValue(row: StockRow, field: NumericField): number | null {
  const v = row[field]
  if (v === null) return null
  return FIELDS[field].fraction ? v * 100 : v
}

export function applyScreen(rows: StockRow[], screen: Screen): StockRow[] {
  const matched = rows.filter((row) => {
    if (screen.kind === 'stock' && row.isEtf) return false
    if (screen.kind === 'etf' && !row.isEtf) return false
    if (screen.industry && row.industry !== screen.industry) return false
    return screen.filters.every((f) => {
      const v = fieldValue(row, f.field)
      if (f.min === undefined && f.max === undefined) return true
      if (v === null) return false
      return (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)
    })
  })
  const sorted = matched
    .filter((r) => fieldValue(r, screen.sortBy) !== null || !(screen.topPercent || screen.topCount))
    .sort((a, b) => {
      const va = fieldValue(a, screen.sortBy)
      const vb = fieldValue(b, screen.sortBy)
      if (va === null) return 1
      if (vb === null) return -1
      return screen.sortDesc ? vb - va : va - vb
    })
  if (screen.topCount) return sorted.slice(0, screen.topCount)
  if (screen.topPercent) return sorted.slice(0, Math.max(1, Math.ceil((sorted.length * screen.topPercent) / 100)))
  return sorted
}

export function industries(rows: StockRow[]): string[] {
  return [...new Set(rows.map((r) => r.industry))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

export function formatField(row: StockRow, field: NumericField): string {
  const v = fieldValue(row, field)
  if (v === null) return '—'
  const def = FIELDS[field]
  if (field === 'marketCap') return Math.round(v).toLocaleString('zh-TW')
  return `${v.toFixed(def.unit === '%' ? 1 : 2)}`
}
