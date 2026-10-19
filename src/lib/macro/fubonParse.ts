import type { AllocationView, FubonOutlookContent, TrackedIndex } from '../storage/schema'

// Rule-based reading of the monthly 「富邦總經觀點－市場展望」 PDF. The layout is
// fixed: page 1 has the date and table of contents, page 2 the allocation
// table (asset class, ▲●▼ view, explanation with the forecast range), and
// later pages key points marked ➢ plus sentences such as 「預估…於 X~Y」 and
// 「月底收於 Z」.

export interface PdfItem {
  x: number
  y: number
  // Rendered width; used to split a line where columns meet.
  w?: number
  str: string
}

// One page = its text items (PDF coordinates: y grows upwards).
export type PdfPage = PdfItem[]

export interface FubonValuation {
  pe: number
  average: number | null
  sdLow: number | null
  sdHigh: number | null
}

export interface ParsedFubon extends FubonOutlookContent {
  valuation: FubonValuation | null
}

function rowsOf(page: PdfPage): PdfItem[][] {
  const rows: { y: number; items: PdfItem[] }[] = []
  for (const item of [...page].sort((a, b) => b.y - a.y)) {
    if (!item.str.trim()) continue
    const row = rows.find((r) => Math.abs(r.y - item.y) <= 3)
    if (row) row.items.push(item)
    else rows.push({ y: item.y, items: [item] })
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x))
}

// Lines in reading order: items within 3pt vertically form one line.
export function toLines(page: PdfPage): string[] {
  return rowsOf(page).map((items) => items.map((i) => i.str).join('').trim())
}

const COLUMN_GAP = 12
const COLUMN_SNAP = 30

interface Segment {
  x: number
  y: number
  text: string
}

// Pieces of each line, split where a wide gap separates two columns.
function toSegments(page: PdfPage): Segment[] {
  const segments: Segment[] = []
  for (const items of rowsOf(page)) {
    let current: PdfItem[] = []
    let end = -Infinity
    for (const item of items) {
      if (current.length > 0 && item.x - end > COLUMN_GAP) {
        segments.push({ x: current[0].x, y: current[0].y, text: current.map((i) => i.str).join('') })
        current = []
      }
      current.push(item)
      end = item.x + (item.w ?? item.str.length * 6)
    }
    if (current.length > 0) segments.push({ x: current[0].x, y: current[0].y, text: current.map((i) => i.str).join('') })
  }
  return segments
}

// Text read column by column: each line is split where a wide gap separates
// two columns (text beside a chart), segments are grouped by their starting
// x, and each column is read top to bottom. Sentences that wrap inside a
// column stay together.
export function toColumnText(page: PdfPage): string[] {
  const segments = toSegments(page)
  const columns: { x: number; parts: { y: number; text: string }[] }[] = []
  for (const seg of [...segments].sort((a, b) => a.x - b.x)) {
    const col = columns.find((c) => Math.abs(c.x - seg.x) <= COLUMN_SNAP)
    if (col) col.parts.push(seg)
    else columns.push({ x: seg.x, parts: [seg] })
  }
  return columns.map((c) =>
    c.parts
      .sort((a, b) => b.y - a.y)
      .map((p) => p.text.trim())
      .join(''),
  )
}

const VIEW_MARKS: Record<string, AllocationView> = { '▲': 'positive', '●': 'neutral', '▼': 'negative' }
const ASSET_PATTERN = /^[一-龥]{2,4}(公債|股市|公司債|高收益債|投資級債|債券|REITs)$/

// Asset rows of the allocation table that carry a forecast range.
const ROW_INDEX: Record<string, TrackedIndex> = {
  美國公債: 'us10y',
  台灣公債: 'tw10y',
  中國公債: 'cn10y',
  美國股市: 'sp500',
  歐洲股市: 'stoxx600',
  台灣股市: 'taiex',
  中國股市: 'csi300',
}

const RANGE = /(\d[\d,]*(?:\.\d+)?)\s*[~～]\s*(\d[\d,]*(?:\.\d+)?)/g

function num(text: string): number {
  return Number(text.replace(/,/g, ''))
}

function lastRange(text: string): { low: number; high: number } | null {
  const all = [...text.matchAll(RANGE)]
  const m = all[all.length - 1]
  if (!m) return null
  const [low, high] = [num(m[1]), num(m[2])]
  return low > 0 && high >= low ? { low, high } : null
}

export function parseAllocation(page: PdfPage): { asset: string; view: AllocationView; note: string }[] {
  const items = page.filter((i) => i.str.trim())
  const assets = items.filter((i) => ASSET_PATTERN.test(i.str.trim()))
  // Only marks on an asset's row count (the legend also contains ▲●▼).
  const marks = items.filter(
    (i) => i.str.trim() in VIEW_MARKS && assets.some((a) => Math.abs(a.y - i.y) <= 15 && i.x > a.x),
  )
  if (assets.length === 0 || marks.length === 0) return []
  const markX = Math.max(...marks.map((m) => m.x))
  const footer = items.find((i) => i.str.includes('資料來源'))?.y ?? -Infinity
  const header = items.find((i) => i.str.trim() === '說明' || i.str.trim() === '展望')?.y ?? Infinity
  const description = items.filter(
    (i) => i.x > markX + 20 && i.y > footer + 2 && i.y < header - 2 && !(i.str.trim() in VIEW_MARKS),
  )

  const rows = assets.map((a) => {
    const mark = marks.reduce((best, m) => (Math.abs(m.y - a.y) < Math.abs(best.y - a.y) ? m : best))
    return { asset: a.str.trim(), y: a.y, view: VIEW_MARKS[mark.str.trim()], parts: [] as PdfItem[] }
  })
  for (const d of description) {
    const row = rows.reduce((best, r) => (Math.abs(r.y - d.y) < Math.abs(best.y - d.y) ? r : best))
    row.parts.push(d)
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => ({ asset: r.asset, view: r.view, note: toLines(r.parts).join('') }))
}

// Words that name each tracked index in the text, and the values each can
// plausibly take (guards against stray numbers).
const INDEX_WORDS: { index: TrackedIndex; words: string[]; range: [number, number] }[] = [
  { index: 'sp500', words: ['S&P500', 'S&P 500', '標普500', '標普'], range: [3000, 15000] },
  { index: 'taiex', words: ['加權指數', '台股'], range: [10000, 80000] },
  { index: 'stoxx600', words: ['Stoxx 600', 'Stoxx600', '泛歐600', '歐股'], range: [300, 1000] },
  { index: 'csi300', words: ['滬深300'], range: [2500, 8000] },
  { index: 'dxy', words: ['美元指數', '美元'], range: [80, 120] },
  { index: 'eurusd', words: ['歐元'], range: [0.9, 1.4] },
  { index: 'usdjpy', words: ['日圓'], range: [100, 200] },
  { index: 'usdcny', words: ['人民幣', '境內、境外', '境內'], range: [6, 8] },
  { index: 'usdtwd', words: ['新台幣'], range: [25, 40] },
]

const plausible = (index: TrackedIndex, v: number) => {
  const def = INDEX_WORDS.find((d) => d.index === index)
  return def !== undefined && v >= def.range[0] && v <= def.range[1]
}

// The index whose word appears closest to `at` (before it, within `back`
// characters; otherwise just after, within `ahead`) and fits the value.
function indexNear(text: string, at: number, value: number, back = 80, ahead = 30): TrackedIndex | null {
  let best: { index: TrackedIndex; distance: number } | null = null
  for (const def of INDEX_WORDS) {
    if (!plausible(def.index, value)) continue
    for (const word of def.words) {
      const before = text.lastIndexOf(word, at)
      if (before >= 0 && at - before <= back && (!best || at - before < best.distance)) {
        best = { index: def.index, distance: at - before }
      }
      const after = text.indexOf(word, at)
      if (after >= 0 && after - at <= ahead && (!best || after - at + back < best.distance)) {
        best = { index: def.index, distance: after - at + back }
      }
    }
  }
  return best?.index ?? null
}

export function parseForecasts(
  allocation: { asset: string; note: string }[],
  text: string,
): FubonOutlookContent['forecasts'] {
  const out: FubonOutlookContent['forecasts'] = []
  for (const row of allocation) {
    const index = ROW_INDEX[row.asset]
    const range = index ? lastRange(row.note) : null
    if (index && range) out.push({ index, ...range })
  }
  // Other ranges (mostly currencies): 「預估本月份歐元於1.13~1.18間波動」.
  for (const m of text.matchAll(/於\s*(\d[\d,]*(?:\.\d+)?)\s*[~～]\s*(\d[\d,]*(?:\.\d+)?)(?!\s*[%％])/g)) {
    const [low, high] = [num(m[1]), num(m[2])]
    if (!(high >= low)) continue
    const index = indexNear(text, m.index, low)
    if (index && plausible(index, high) && !out.some((f) => f.index === index)) out.push({ index, low, high })
  }
  return out
}

// Last month's closes: 「S&P 500全月上漲2.62%至7,686.2」「月底時收於31.67」…
// Each close is attributed to the nearest index word before it and kept
// only if plausible for that index and within ±40% of its forecast.
export function parseActuals(text: string, forecasts: FubonOutlookContent['forecasts']): FubonOutlookContent['actuals'] {
  const out: FubonOutlookContent['actuals'] = []
  // 「月底美元指數升至101.8」 is another way the reports state a close.
  for (const m of text.matchAll(/(?:收於|收至|全月[^。，]{0,12}?至|月底[^。，]{0,10}?至)\s*(\d[\d,]*(?:\.\d+)?)(?!\s*[%％])/g)) {
    const value = num(m[1])
    // Look for the index name before the number (it may follow 「月底」).
    const at = m.index + m[0].length - m[1].length
    const index = indexNear(text, at, value, 120, 0)
    if (!index || out.some((a) => a.index === index)) continue
    const f = forecasts.find((x) => x.index === index)
    const mid = f ? (f.low + f.high) / 2 : null
    if (mid === null || Math.abs(value / mid - 1) <= 0.4) out.push({ index, value })
  }
  return out
}

export function parseValuation(text: string): FubonValuation | null {
  const pe = /預估本益比為\s*([\d.]+)\s*倍/.exec(text)
  if (!pe) return null
  const avg = /近\s*10\s*年平均\s*([\d.]+)/.exec(text)
  const sd = /一個標準差\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(text)
  return {
    pe: Number(pe[1]),
    average: avg ? Number(avg[1]) : null,
    sdLow: sd ? Number(sd[1]) : null,
    sdHigh: sd ? Number(sd[2]) : null,
  }
}

// Table of contents on page 1: 「2. 總經觀點P3-5」 → section pages.
export function parseContents(lines: string[]): { title: string; from: number; to: number }[] {
  const text = lines.join('\n')
  // 「P24.」 is page 2 followed by item 4, hence the lazy page number that
  // must be followed by the next item or the end.
  // Items are numbered 1. 2. … or, since 2026/10, I. II. ….
  return [...text.matchAll(/(?:\d|[IVX]+)\.\s*([一-龥/／]+?)\s*P(\d+?)(?:\s*-\s*(\d+?))?(?=[ \t]*(?:\d|[IVX]+)\.|[ \t]*\n|[ \t]*$)/g)]
    .map((m) => ({ title: m[1], from: Number(m[2]), to: Number(m[3] ?? m[2]) }))
    .sort((a, b) => a.from - b.from)
}

// Key points are the ➢ lines; they are grouped by the table of contents.
export function parseSections(pages: PdfPage[]): FubonOutlookContent['sections'] {
  const contents = parseContents(toLines(pages[0] ?? []))
  // Each ➢ heading is a line of its own.
  const bullets = pages.flatMap((page, i) =>
    toSegments(page)
      .filter((seg) => seg.text.trim().startsWith('➢'))
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((seg) => ({ text: seg.text.replace(/^\s*➢\s*/, '').trim(), page: i + 1 })),
  )
  return contents
    .map((c) => ({
      title: c.title,
      bullets: bullets.filter((b) => b.page >= c.from && b.page <= c.to).map((b) => ({ text: b.text, page: `p.${b.page}` })),
    }))
    .filter((s) => s.bullets.length > 0)
}

export function parseReportDate(lines: string[]): string | null {
  const m = /(20\d{2})\/(\d{1,2})\/(\d{1,2})/.exec(lines.join(' '))
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

export interface ListedReport {
  path: string
  title: string
  // Upload date on the research list (YYYY-MM-DD).
  listedDate: string
}

// Monthly outlooks on the research list page. Uploads are not named
// consistently (the October 2026 issue has a random file name and a "9月"
// title), so rows are matched by title and the real date is read from
// the PDF itself later.
export function parseResearchList(html: string): ListedReport[] {
  const out: ListedReport[] = []
  for (const row of html.split(/<tr\b/).slice(1)) {
    const date = /(20\d{2})\/(\d{2})\/(\d{2})/.exec(row)
    const link = /<a href="(\/api\/publish\/report\/[^"]+\.pdf)"[^>]*>([^<]*)<\/a>/.exec(row)
    if (!date || !link) continue
    const [, path, title] = link
    if (!title.includes('市場展望') && !/富邦市場展望\d{6}\.pdf$/.test(path)) continue
    out.push({ path, title: title.trim(), listedDate: `${date[1]}-${date[2]}-${date[3]}` })
  }
  // Older issues appear only in the page's embedded data, by file name.
  for (const m of html.matchAll(/(?:\/|\\u002F)api(?:\/|\\u002F)publish(?:\/|\\u002F)report(?:\/|\\u002F)(富邦市場展望\d{6}\.pdf)/g)) {
    const path = `/api/publish/report/${m[1]}`
    const listedDate = dateFromFileName(m[1])
    if (listedDate && !out.some((o) => o.path === path)) out.push({ path, title: '', listedDate })
  }
  return out.sort((a, b) => b.listedDate.localeCompare(a.listedDate))
}

// 「富邦市場展望090226.pdf」 → 2026-09-02
export function dateFromFileName(fileName: string): string | null {
  const m = /(\d{2})(\d{2})(\d{2})\.pdf$/.exec(fileName)
  return m ? `20${m[3]}-${m[1]}-${m[2]}` : null
}

export function parseFubonReport(pages: PdfPage[], fallbackDate: string): ParsedFubon {
  const lines = pages.map(toLines)
  const text = pages.map((p) => toColumnText(p).join('')).join('')
  const reportDate = parseReportDate(lines[0] ?? []) ?? fallbackDate
  const allocation = parseAllocation(pages[1] ?? [])
  const forecasts = parseForecasts(allocation, text)
  const sections = parseSections(pages)
  const macro = sections.find((s) => s.title.includes('總經')) ?? sections[0]
  const month = Number(reportDate.slice(5, 7))
  return {
    reportTitle: `富邦總經觀點-${month}月市場展望`,
    reportDate,
    summary: macro ? macro.bullets.map((b) => b.text).join('；') : '',
    sections,
    allocation,
    forecasts,
    actuals: parseActuals(text, forecasts),
    coverage: [],
    valuation: parseValuation(text),
  }
}
