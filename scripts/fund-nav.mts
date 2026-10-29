// Builds public/data/funds.json: the latest NAV of every fund on the Anue
// (鉅亨) fund list. The API needs no key but blocks browsers (no CORS), so
// GitHub Actions fetches it daily and the site reads this same-origin file.
//
//   npx tsx scripts/fund-nav.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FundNavData } from '../src/lib/market/fundNav.ts'

const OUT = 'public/data/funds.json'
const API = 'https://fund.api.cnyes.com/fund/api/v2/search/fund'
const UA = 'Mozilla/5.0 (personal-wealth-management data job)'
const PAGE = 2000
const FIELDS = 'nav,priceDate,cnyesId,displayNameLocal,classCurrencyLocal'

interface Row {
  cnyesId: string
  displayNameLocal: string
  nav: number | null
  priceDate: number | null
  classCurrencyLocal: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function page(n: number): Promise<{ rows: Row[]; last: number }> {
  // A fixed order keeps pages from overlapping while the list updates.
  const url = `${API}?keyword=&page=${n}&limit=${PAGE}&order=cnyesId&sort=asc&fields=${FIELDS}`
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  const json = (await response.json()) as { items: { data: Row[]; last_page: number } }
  return { rows: json.items.data, last: json.items.last_page }
}

// Unix seconds (Taiwan midnight) → YYYY-MM-DD in Taiwan time.
function taiwanDate(seconds: number): string {
  return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(0, 10)
}

const errors: string[] = []
const funds: FundNavData['funds'] = []
const seen = new Set<string>()
try {
  let n = 1
  let last = 1
  do {
    const r = await page(n)
    last = r.last
    for (const row of r.rows) {
      if (!row.cnyesId || !row.nav || !row.priceDate || seen.has(row.cnyesId)) continue
      seen.add(row.cnyesId)
      funds.push([row.cnyesId, row.displayNameLocal, row.nav, taiwanDate(row.priceDate), row.classCurrencyLocal ?? ''])
    }
    n += 1
    await sleep(1000)
  } while (n <= last)
} catch (error) {
  errors.push(`基金淨值：${error instanceof Error ? error.message : String(error)}`)
}

const data: FundNavData = { generatedAt: new Date().toISOString(), errors, funds }
mkdirSync('public/data', { recursive: true })
writeFileSync(OUT, JSON.stringify(data))
console.log(`funds.json: ${funds.length} 檔${errors.length ? `，錯誤：${errors.join('；')}` : ''}`)
