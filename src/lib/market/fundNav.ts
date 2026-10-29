// public/data/funds.json, built daily by GitHub Actions
// (scripts/fund-nav.mts) from the Anue (鉅亨) fund list: the latest NAV of
// every fund sold in Taiwan. The source blocks browser requests, so the
// site reads this same-origin snapshot. It holds public fund data only.

export interface FundNav {
  // Anue fund code, e.g. "A04008" or "B16,009".
  code: string
  name: string
  nav: number
  // YYYY-MM-DD
  date: string
  // Currency name as Anue writes it, e.g. 新台幣, 美元, 歐元.
  currency: string
}

export interface FundNavData {
  generatedAt: string
  errors: string[]
  // [code, name, nav, date, currency]
  funds: [string, string, number, string, string][]
}

export const FUND_DATA_PATH = 'data/funds.json'

export function unpackFunds(data: FundNavData): FundNav[] {
  return data.funds.map(([code, name, nav, date, currency]) => ({ code, name, nav, date, currency }))
}

let cache: Promise<FundNav[] | null> | null = null

// The snapshot, fetched at most once per page load.
export function fetchFundNavs(base: string = import.meta.env.BASE_URL): Promise<FundNav[] | null> {
  cache ??= fetch(`${base}${FUND_DATA_PATH}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<FundNavData>) : null))
    .then((d) => (d ? unpackFunds(d) : null))
    .catch(() => null)
  return cache
}

const codeKey = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '')
const nameKey = (s: string) => s.replace(/\s+/g, '').toUpperCase()

// The fund a holding refers to: by code (punctuation ignored), else by an
// exact name.
export function findFund(holding: { ticker: string; name: string }, funds: FundNav[]): FundNav | null {
  const code = codeKey(holding.ticker)
  if (code) {
    const byCode = funds.find((f) => codeKey(f.code) === code)
    if (byCode) return byCode
  }
  const name = nameKey(holding.name)
  return name ? (funds.find((f) => nameKey(f.name) === name) ?? null) : null
}

// Funds whose name or code contains every word of the query.
export function searchFunds(query: string, funds: FundNav[], limit = 8): FundNav[] {
  const words = query.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return funds
    .filter((f) =>
      words.every((w) => {
        const code = codeKey(w)
        return f.name.toUpperCase().includes(w) || (code !== '' && codeKey(f.code).includes(code))
      }),
    )
    .slice(0, limit)
}

// Holdings are kept in TWD or USD; other fund currencies need a manual NAV.
export function fundCurrency(currency: string): 'TWD' | 'USD' | null {
  if (currency === '新台幣') return 'TWD'
  if (currency === '美元') return 'USD'
  return null
}
