import { useEffect, useState } from 'react'

// Daily TWSE-wide price/earnings ratio (market-cap weighted), kept by the
// deploy job in public/data/valuation.json from data/stocks.json.
export interface ValuationPoint {
  date: string
  pe: number
}

export const VALUATION_DATA_PATH = 'data/valuation.json'

// Total market value ÷ total earnings, from each stock's value and P/E;
// ETFs and losses (no P/E) are left out.
export function aggregatePe(stocks: { isEtf?: boolean; pe: number | null; marketCap: number | null }[]): number | null {
  let cap = 0
  let earnings = 0
  for (const s of stocks) {
    if (s.isEtf || !s.pe || s.pe <= 0 || !s.marketCap || s.marketCap <= 0) continue
    cap += s.marketCap
    earnings += s.marketCap / s.pe
  }
  return earnings > 0 ? Math.round((cap / earnings) * 100) / 100 : null
}

let shared: Promise<ValuationPoint[]> | null = null

async function fetchValuation(base: string = import.meta.env.BASE_URL): Promise<ValuationPoint[]> {
  try {
    const res = await fetch(`${base}${VALUATION_DATA_PATH}`, { cache: 'no-cache' })
    if (!res.ok) return []
    return ((await res.json()) as { points: ValuationPoint[] }).points
  } catch {
    return []
  }
}

export function useValuation(): ValuationPoint[] {
  const [points, setPoints] = useState<ValuationPoint[]>([])
  useEffect(() => {
    if (!shared) shared = fetchValuation()
    let alive = true
    void shared.then((p) => alive && setPoints(p))
    return () => {
      alive = false
    }
  }, [])
  return points
}
