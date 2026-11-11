import type { StockThesis, TradingStrategy } from '../storage/schema'
import { parseSymbol } from '../backtest/templates'
import type { SignalReport } from './signals'

// Research cards and strategy cards are linked by ticker: a strategy's
// symbol shows that card's verdict and advice, a card lists the strategies
// trading it, and a strategy's real-money entry is checked against the card
// (pre-trade checklist). Nothing is stored; the link follows the codes.

const bareCode = (ticker: string) => ticker.trim().toUpperCase().replace(/\.TWO?$/, '')

// Taiwan ETF codes start with 00; other Taiwan codes are individual stocks.
export function isStockCode(market: 'TW' | 'US', code: string): boolean {
  return market === 'TW' && !code.startsWith('00')
}

export function thesisForCode(market: 'TW' | 'US', code: string, theses: StockThesis[]): StockThesis | null {
  const c = bareCode(code)
  return theses.find((t) => t.status !== 'exited' && t.market === market && bareCode(t.ticker) === c) ?? null
}

export interface LinkedSymbol {
  symbol: string
  market: 'TW' | 'US'
  code: string
  thesis: StockThesis | null
  isStock: boolean
}

export function thesesForStrategy(strategy: Pick<TradingStrategy, 'symbols'>, theses: StockThesis[]): LinkedSymbol[] {
  return strategy.symbols.map((symbol) => {
    const { market, code } = parseSymbol(symbol)
    return { symbol, market, code, thesis: thesisForCode(market, code, theses), isStock: isStockCode(market, code) }
  })
}

export function strategiesForThesis(thesis: Pick<StockThesis, 'ticker' | 'market'>, strategies: TradingStrategy[]): TradingStrategy[] {
  const c = bareCode(thesis.ticker)
  return strategies.filter(
    (s) =>
      s.status !== 'retired' &&
      s.symbols.some((symbol) => {
        const { market, code } = parseSymbol(symbol)
        return market === thesis.market && code === c
      }),
  )
}

// Why a research card stops a strategy's real-money entry, if it does.
export function researchBlocks(thesis: Pick<StockThesis, 'verdict'>, report: Pick<SignalReport, 'action' | 'headline'> | null): string[] {
  const out: string[] = []
  if (thesis.verdict === 'pass') out.push('研究卡結論為不投資')
  if (report && (report.action === 'review' || report.action === 'exit')) {
    out.push(`研究卡建議${report.action === 'review' ? '需要複查' : '出清'}：${report.headline}`)
  }
  return out
}
