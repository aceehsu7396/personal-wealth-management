import type { DailyClose } from '../storage/schema'

const TAIEX_ENDPOINT = 'https://www.twse.com.tw/exchangeReport/FMTQIK'
const TW0050_ENDPOINT = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY'

interface TwseTableResponse {
  stat: string
  data?: string[][]
}

function rocDateToIso(rocDate: string): string {
  const [rocYear, month, day] = rocDate.split('/')
  const year = Number(rocYear) + 1911
  return `${year}-${month}-${day}`
}

function parseNumber(value: string): number {
  return Number(value.replace(/,/g, ''))
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

async function fetchMonth(
  endpoint: string,
  monthDate: Date,
  closeColumnIndex: number,
  extraParams: Record<string, string> = {},
): Promise<DailyClose[]> {
  const params = new URLSearchParams({
    response: 'json',
    date: yyyymmdd(monthDate),
    ...extraParams,
  })
  const response = await fetch(`${endpoint}?${params.toString()}`)
  if (!response.ok) throw new Error(`TWSE 請求失敗：${response.status}`)
  const json: TwseTableResponse = await response.json()
  if (json.stat !== 'OK' || !json.data) return []
  return json.data.map((row) => ({
    date: rocDateToIso(row[0]),
    close: parseNumber(row[closeColumnIndex]),
  }))
}

export async function fetchTaiexMonth(monthDate: Date): Promise<DailyClose[]> {
  return fetchMonth(TAIEX_ENDPOINT, monthDate, 4)
}

export async function fetchTw0050Month(monthDate: Date): Promise<DailyClose[]> {
  return fetchMonth(TW0050_ENDPOINT, monthDate, 6, { stockNo: '0050' })
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function fetchRecentTaiexAndTw0050(): Promise<{
  taiex: DailyClose[]
  tw0050: DailyClose[]
}> {
  const now = new Date()
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const [taiexThis, taiexPrev, tw0050This, tw0050Prev] = await Promise.all([
    fetchTaiexMonth(now),
    fetchTaiexMonth(previousMonth),
    fetchTw0050Month(now),
    fetchTw0050Month(previousMonth),
  ])

  return {
    taiex: [...taiexPrev, ...taiexThis],
    tw0050: [...tw0050Prev, ...tw0050This],
  }
}
