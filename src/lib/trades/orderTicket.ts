import type { TradePlan } from '../storage/schema'

// Order drafts (handbook 04 §0.2): the orders to place at the
// broker for a trade plan, on valid price ticks, split into board lots and
// intraday odd lots, with the stop (or a one-cancels-other order with the
// first target) to set once filled. The site never connects to a broker.

// TWSE 升降單位, checked 2026-11-13 on twse.com.tw 集中市場交易制度介紹
// (壹、一般交易 4): lower bound inclusive.
const STOCK_TICKS: [number, number][] = [
  [1000, 5],
  [500, 1],
  [100, 0.5],
  [50, 0.1],
  [10, 0.05],
  [0, 0.01],
]
const ETF_TICKS: [number, number][] = [
  [50, 0.05],
  [0, 0.01],
]

export const BOARD_LOT = 1000
export const FEE_RATE = 0.001425
export const MIN_FEE = 20
export const PRICE_LIMIT = 0.1

// Taiwan ETFs (and ETNs) have codes starting with 00.
export const isTwEtf = (ticker: string) => /^00/.test(ticker)

export function tickOf(price: number, market: 'TW' | 'US', ticker: string): number {
  if (market === 'US') return 0.01
  const table = isTwEtf(ticker) ? ETF_TICKS : STOCK_TICKS
  return table.find(([from]) => price >= from)![1]
}

const round = (v: number) => Math.round(v * 100) / 100
// Snap to a valid tick: down for a buy limit (never pay more than planned),
// up for a stop trigger (never lose a tick more than planned).
export function snap(price: number, market: 'TW' | 'US', ticker: string, direction: 'down' | 'up'): number {
  const tick = tickOf(price, market, ticker)
  const n = price / tick
  const steps = direction === 'down' ? Math.floor(n + 1e-9) : Math.ceil(n - 1e-9)
  return round(steps * tick)
}

export function splitLots(shares: number): { lots: number; odd: number } {
  return { lots: Math.floor(shares / BOARD_LOT), odd: shares % BOARD_LOT }
}

export function fee(value: number, discount = 1, market: 'TW' | 'US' = 'TW'): number {
  if (market === 'US' || value <= 0) return 0
  return Math.max(MIN_FEE, Math.floor(value * FEE_RATE * discount))
}

export const sellTax = (value: number, ticker: string, market: 'TW' | 'US' = 'TW') => (market === 'US' ? 0 : Math.floor(value * (isTwEtf(ticker) ? 0.001 : 0.003)))

export interface TicketLine {
  when: '進場' | '成交後'
  text: string
}

export interface OrderTicket {
  lines: TicketLine[]
  entry: number | null
  stop: number | null
  costs: { buyFee: number; stopSellCost: number; lossAtStop: number } | null
  warnings: string[]
}

const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const sharesText = (shares: number, market: 'TW' | 'US') => {
  if (market === 'US') return `${fmt(shares)} 股`
  const { lots, odd } = splitLots(shares)
  return [lots > 0 ? `整股 ${lots} 張` : '', odd > 0 ? `盤中零股 ${odd} 股` : ''].filter(Boolean).join('＋')
}

export const TIF_NOTE = 'ROD：當日有效，沒成交就一直掛到收盤；IOC：立即成交、沒成交的部分取消；FOK：全部成交否則全部取消。'
export const BROKER_NOTE = '觸價單與二擇一單由券商執行，不是交易所的委託；跌停鎖住或開盤跳空時，可能無法依觸發價成交。系統不連接券商、不下單。'

export function orderTicket(plan: Pick<TradePlan, 'ticker' | 'market' | 'orderType' | 'entryPrice' | 'stopLoss' | 'currentStop' | 'shares' | 'targets' | 'status'>, shares = plan.shares, discount = 1): OrderTicket {
  const m = plan.market
  const warnings: string[] = []
  const lines: TicketLine[] = []
  const entry = plan.entryPrice ? snap(plan.entryPrice, m, plan.ticker, 'down') : null
  const stopRaw = plan.currentStop ?? plan.stopLoss
  const stop = stopRaw ? snap(stopRaw, m, plan.ticker, 'up') : null
  if (!shares || shares <= 0) return { lines, entry, stop, costs: null, warnings: ['還沒有填股數'] }

  if (plan.status === 'draft') {
    if (plan.orderType === 'market') lines.push({ when: '進場', text: `市價買進 ${plan.ticker}，${sharesText(shares, m)}（市價單不保證價格，流動性低時可能成交在很差的價位）` })
    else if (plan.orderType === 'stop' && entry) lines.push({ when: '進場', text: `觸價買進 ${plan.ticker}：漲到 ${fmt(entry)} 時送出限價 ${fmt(entry)}，${sharesText(shares, m)}，ROD` })
    else if (entry) lines.push({ when: '進場', text: `限價買進 ${plan.ticker} ${fmt(entry)}，${sharesText(shares, m)}，ROD` })
    if (entry && plan.entryPrice && entry !== round(plan.entryPrice)) warnings.push(`計畫價 ${fmt(plan.entryPrice)} 不在升降單位上，改為 ${fmt(entry)}`)
  }

  const target = [...plan.targets].sort((a, b) => a.price - b.price)[0]
  if (stop) {
    if (target) {
      const t = snap(target.price, m, plan.ticker, 'down')
      const part = target.fraction >= 1 ? shares : Math.floor(shares * target.fraction)
      lines.push({ when: '成交後', text: `二擇一單（OCO）：觸價賣出 ${fmt(stop)} 全部 ${sharesText(shares, m)}；或限價賣出 ${fmt(t)} ${sharesText(part, m)}（第一個停利）` })
    } else lines.push({ when: '成交後', text: `觸價賣出 ${plan.ticker}：跌到 ${fmt(stop)} 時賣出全部 ${sharesText(shares, m)}` })
  } else warnings.push('還沒有停損：成交後沒有可以掛的停損單')

  if (entry && stop && entry > stop && (entry - stop) / entry > PRICE_LIMIT && m === 'TW') {
    warnings.push(`停損距離 ${(((entry - stop) / entry) * 100).toFixed(1)}% 超過單日漲跌幅 10%：可能要兩天以上才觸及，跳空時虧損會更大`)
  }
  if (m === 'US') warnings.push('美股另有換匯成本與匯款手續費，記得算進去')

  let costs: OrderTicket['costs'] = null
  if (entry) {
    const buyFee = fee(entry * shares, discount, m)
    const stopValue = (stop ?? 0) * shares
    const stopSellCost = stop ? fee(stopValue, discount, m) + sellTax(stopValue, plan.ticker, m) : 0
    costs = { buyFee, stopSellCost, lossAtStop: stop ? (entry - stop) * shares + buyFee + stopSellCost : 0 }
  }
  return { lines, entry, stop, costs, warnings }
}
