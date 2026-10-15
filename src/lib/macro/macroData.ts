import type { ParsedFubon } from './fubonParse'
import type { FubonOutlook } from '../storage/schema'

// public/data/macro.json, built daily by GitHub Actions
// (scripts/macro-data.ts) from public sources that need no API key and
// cannot be read from the browser directly (no CORS).

export interface Point {
  date: string
  value: number
}

export const FRED_SERIES = {
  IPMAN: '美國製造業工業生產（ISM 代理）',
  UNRATE: '美國失業率',
  PAYEMS: '美國非農就業人數',
  CPIAUCSL: '美國 CPI',
  PCEPILFE: '美國核心 PCE',
  FEDFUNDS: '聯邦基金利率',
  T10Y2Y: '美債 10 年減 2 年利差',
  BAMLH0A0HYM2: '美國高收益債利差',
  WALCL: 'Fed 資產負債表',
  DTWEXBGS: '美元指數（廣義）',
  VIXCLS: 'VIX 恐慌指數',
} as const

export const TW_SERIES = {
  TW_BUSINESS_SCORE: '台灣景氣對策信號分數',
  TW_EXPORTS: '台灣海關出口值',
  TW_CPI: '台灣 CPI',
} as const

export type SeriesKey = keyof typeof FRED_SERIES | keyof typeof TW_SERIES

export const SERIES_SOURCES: Record<SeriesKey, string> = {
  ...(Object.fromEntries(Object.keys(FRED_SERIES).map((k) => [k, `FRED ${k}`])) as Record<keyof typeof FRED_SERIES, string>),
  TW_BUSINESS_SCORE: '國發會景氣指標',
  TW_EXPORTS: '國發會同時指標',
  TW_CPI: '主計總處',
}

export interface FubonReportData extends ParsedFubon {
  pdfUrl: string
}

export interface MacroData {
  generatedAt: string
  // Sources that failed this run; their fields are missing.
  errors: string[]
  series: Partial<Record<SeriesKey, Point[]>>
  // TWSE margin purchase balance (NT$ thousand), today and ~3 months ago.
  margin: { now: Point; before: Point } | null
  // Monthly Fubon outlooks, oldest first.
  fubon: FubonReportData[]
}

export const MACRO_DATA_PATH = 'data/macro.json'

export async function fetchMacroData(base: string = import.meta.env.BASE_URL): Promise<MacroData | null> {
  try {
    const response = await fetch(`${base}${MACRO_DATA_PATH}`, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as MacroData
  } catch {
    return null
  }
}

export function latestFubon(data: MacroData | null): FubonReportData | undefined {
  return data?.fubon[data.fubon.length - 1]
}

// Parsed reports in the app's FubonOutlook shape (used by tracking and the
// market prompt). Ids are stable per issue.
export function toOutlooks(data: MacroData): FubonOutlook[] {
  return data.fubon.map((r) => ({
    id: `auto-${r.reportDate}`,
    reportTitle: r.reportTitle,
    reportDate: r.reportDate,
    pdfUrl: r.pdfUrl,
    createdAt: data.generatedAt,
    markdown: '',
    sources: [{ title: r.reportTitle, url: r.pdfUrl, kind: 'fetched' as const }],
    estimatedCostUsd: 0,
    summary: r.summary,
    sections: r.sections,
    allocation: r.allocation,
    forecasts: r.forecasts,
    actuals: r.actuals,
    coverage: r.coverage,
  }))
}
