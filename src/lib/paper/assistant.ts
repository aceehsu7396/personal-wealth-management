import type { Bar } from '../market/priceHistory'
import type { AssistantItem, AssistantKind, InvestmentPolicy, PaperAccount, PaperFunds, PlanAdvice, SignalOutcome, TradingStrategy } from '../storage/schema'
import type { SymbolStatus } from '../backtest/engine'
import { resolveParams } from '../backtest/templates'
import { riskLimitOf } from '../calculations/preTradeChecklist'
import { STOP_ATR_MULTIPLE } from '../research/signals'
import { allows, type RegimeContext } from '../market/regime'
import { ENTRY_METHOD_LABELS, METHOD_OF, scanItem, trailingStop, type ScanItem } from '../trades/tradePlan'
import { formatSymbol } from '../backtest/templates'
import { cadenceOf, lastDecisionDate, WEEKDAY_LABELS } from '../backtest/weekly'
import { poolOf } from './fund'

// The paper-trading entry-exit assistant (handbook 10 §7): the linked
// strategy card's signals turned into orders sized by risk, with a stop on
// every buy, a chandelier stop that only moves up, and a record of what
// was done with each suggestion.

const round2 = (v: number) => Math.round(v * 100) / 100
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const money = (v: number) => Math.round(v).toLocaleString()

// Within this distance of the stop, a position is flagged (as for plans).
export const NEAR_STOP = 0.03
// Prices older than this many calendar days are not good enough to order on.
export const STALE_DAYS = 5
// Suggestions that ask for an order or a stop change.
export const ACTIONABLE: AssistantKind[] = ['enter', 'exit', 'raise_stop']
const MAX_LOG = 300
// All open positions' stop risk together, as % of the trading capital:
// past it no new entry (handbook 10 §7; Elder's 6% rule).
export const OPEN_RISK_LIMIT_PERCENT = 6

// The trading capital (handbook 10 §7): the market's paper cash pool and
// everything its strategies hold. Risk per trade and the open-risk limit
// are shares of it; buys draw on the pool's cash. TW and US are never mixed.
export interface Sleeve {
  capital: number
  // The pool's cash less open buy orders.
  cash: number
  // Shares × (price − stop) over every position with a stop below price.
  openRisk: number
  // Positions without a stop, left out of openRisk.
  unstopped: number
}

export function sleeveOf(accounts: PaperAccount[], market: PaperAccount['market'], funds?: PaperFunds): Sleeve {
  const pool = poolOf(accounts, market, funds)
  return { capital: pool.equity, cash: pool.available, openRisk: pool.openRisk, unstopped: pool.unstopped }
}

const others = (account: PaperAccount, accounts?: PaperAccount[]) => [account, ...(accounts ?? []).filter((a) => a.id !== account.id)]

export const ASSISTANT_KIND_LABELS: Record<AssistantKind, string> = {
  enter: '進場',
  exit: '出場',
  stop_hit: '停損觸發',
  raise_stop: '上調停損',
  near_stop: '接近停損',
  hold: '續抱',
  wait: '觀望',
  no_data: '無法判斷',
}

export const OUTCOME_LABELS: Record<SignalOutcome, string> = {
  pending: '待處理',
  followed: '照做',
  modified: '修改後下單',
  skipped: '略過',
  missed: '未處理',
}

// The stop width: the regime row's multiple replaces the card's (as in
// planFromStrategy). A card without an ATR stop still gets a protective
// one, since every paper buy needs a stop, but it does not trail.
export function stopWidth(strategy: Pick<TradingStrategy, 'template' | 'params'>, regime?: RegimeContext | null): { k: number; protective: boolean } {
  const atrStop = resolveParams(strategy.template, strategy.params).atrStop
  if (atrStop > 0) return { k: regime?.row.stopAtr ?? atrStop, protective: false }
  return { k: STOP_ATR_MULTIPLE, protective: true }
}

export interface PaperSizeInput {
  price: number
  stop: number
  // The trading capital (the market's pool and its holdings).
  equity: number
  // The pool's cash.
  cash: number
  // Stop risk already open across the accounts.
  openRisk?: number
  policy: InvestmentPolicy
  strategy?: Pick<TradingStrategy, 'riskPerTradePercent'>
  multiplier?: number
}

// The pool is the trading sleeve, so the per-trade risk is a share of its
// total, no more than what the open-risk limit leaves; then the regime
// multiplier, then the caps: the pool's cash,
// the single-position limit (rescaled from the whole portfolio to the
// sleeve) and an equal slot for each allowed open position.
export function paperShares(input: PaperSizeInput): { shares: number; basis: string[] } {
  const { price, stop, equity, cash, policy } = input
  if (!(price > stop) || equity <= 0) return { shares: 0, basis: ['停損須低於價格，無法計算股數'] }
  const limit = riskLimitOf(input.strategy, policy)
  const perTrade = (equity * limit.percent) / 100
  const openRisk = input.openRisk ?? 0
  const room = Math.max((equity * OPEN_RISK_LIMIT_PERCENT) / 100 - openRisk, 0)
  const budget = Math.min(perTrade, room)
  const byRisk = Math.floor(budget / (price - stop))
  const multiplier = input.multiplier ?? 1
  const sized = Math.floor(byRisk * multiplier)
  const singleShare = Math.min(1, policy.maxSinglePositionPercent / Math.max(policy.satellitePercent, 1))
  const caps = [
    { label: '可用現金', shares: Math.floor(cash / (price * 1.002)) },
    { label: `單一部位上限（權益 × ${pct(singleShare)}）`, shares: Math.floor((equity * singleShare) / price) },
    { label: `同時持有 ${policy.maxOpenPositions} 檔的平均額度`, shares: Math.floor(equity / policy.maxOpenPositions / price) },
  ]
  const tightest = caps.reduce((a, b) => (b.shares < a.shares ? b : a))
  const shares = Math.max(0, Math.min(sized, tightest.shares))
  const basis = [
    `風險預算 = 總資金 ${money(equity)} × ${limit.percent}%（${limit.source}）= ${money(perTrade)}`,
    ...(openRisk > 0 || room < perTrade
      ? [`未平倉停損風險 ${money(openRisk)}（${((openRisk / equity) * 100).toFixed(1)}%），上限 ${OPEN_RISK_LIMIT_PERCENT}% 還剩 ${money(room)}${room < perTrade ? `，風險預算改為 ${money(budget)}` : ''}`]
      : []),
    `每股風險 = ${price} − 停損 ${stop} = ${round2(price - stop)}，可買 ${byRisk.toLocaleString()} 股`,
  ]
  if (multiplier !== 1) basis.push(`局勢部位倍數 × ${multiplier} = ${sized.toLocaleString()} 股`)
  if (tightest.shares < sized) basis.push(`受「${tightest.label}」限制，取 ${tightest.shares.toLocaleString()} 股`)
  return { shares, basis }
}

export interface AssistantInput {
  strategy: TradingStrategy
  account: PaperAccount
  statuses: SymbolStatus[]
  data: Record<string, Bar[]>
  policy: InvestmentPolicy
  regime?: RegimeContext | null
  // Every paper account and the cash pool, for the trading capital; this
  // account alone if absent.
  accounts?: PaperAccount[]
  funds?: PaperFunds
}

// One suggestion per symbol, the most urgent kind first: an exit signal,
// a broken stop, a stop to raise (or set), a stop close by, then hold.
export function assistantItems({ strategy, account, statuses, data, policy, regime, accounts, funds }: AssistantInput): AssistantItem[] {
  const { k, protective } = stopWidth(strategy, regime)
  const sleeve = sleeveOf(others(account, accounts), account.market, funds)
  const equity = sleeve.capital
  let cash = sleeve.cash
  let openRisk = sleeve.openRisk
  const out: AssistantItem[] = []
  for (const st of statuses) {
    const p = account.positions.find((x) => x.symbol === st.symbol)
    const base = {
      symbol: st.symbol,
      date: st.date,
      close: st.close,
      reading: st.reading,
      basis: [] as string[],
      outcome: 'pending' as const,
      ...(st.decidesOn ? { decidesOn: st.decidesOn } : {}),
      ...(st.levels ? { levels: st.levels } : {}),
      ...(!p && st.atr ? { stopEstimate: round2(st.close - k * st.atr) } : {}),
    }
    if (p) {
      const stop = p.stopLoss
      if (st.state === 'exit') {
        out.push({ ...base, kind: 'exit', side: 'sell', shares: p.shares, basis: ['策略出場訊號：全部賣出'] })
        continue
      }
      if (stop !== undefined && st.close <= stop) {
        out.push({ ...base, kind: 'stop_hit', basis: [`收盤 ${st.close} 已跌破停損 ${stop}；更新收盤價時若盤中觸及會自動賣出`] })
        continue
      }
      if (stop === undefined && st.atr) {
        const set = round2(st.close - k * st.atr)
        out.push({ ...base, kind: 'raise_stop', raiseTo: set, basis: [`這筆部位沒有停損：設 收盤 − ${k} × ATR = ${set}`] })
        continue
      }
      const raise = protective ? null : trailingStop({ trailing: 'chandelier', trailingParam: k, openedAt: p.openedAt, currentStop: stop, stopLoss: stop }, data[st.symbol] ?? [])
      if (raise !== null) {
        out.push({ ...base, kind: 'raise_stop', raiseTo: raise, basis: [`吊燈停損 = 進場後最高價 − ${k} × ATR = ${raise}，高於目前停損 ${stop}；停損只往上調`] })
        continue
      }
      if (stop !== undefined && (st.close - stop) / st.close < NEAR_STOP) {
        out.push({ ...base, kind: 'near_stop', basis: [`收盤 ${st.close} 離停損 ${stop} 不到 ${pct(NEAR_STOP)}；不要下移停損`] })
        continue
      }
      const r = stop !== undefined && p.avgCost > stop ? (st.close - p.avgCost) / (p.avgCost - stop) : null
      out.push({ ...base, kind: st.state === 'no_data' ? 'no_data' : 'hold', basis: [stop !== undefined ? `停損 ${stop}${r !== null ? `，目前 ${r.toFixed(1)}R` : ''}` : '沒有停損'] })
      continue
    }
    if (st.state !== 'enter') {
      out.push({ ...base, kind: st.state === 'exit' || st.state === 'hold' ? 'wait' : st.state })
      continue
    }
    if (!st.atr) {
      out.push({ ...base, kind: 'enter', side: 'buy', basis: ['ATR 資料不足，無法設停損與計算股數'] })
      continue
    }
    const stopLoss = round2(st.close - k * st.atr)
    const size = paperShares({ price: st.close, stop: stopLoss, equity, cash, openRisk, policy, strategy, multiplier: regime?.multiplier })
    cash -= size.shares * st.close
    openRisk += size.shares * (st.close - stopLoss)
    const stopNote = protective
      ? `保護停損 = 收盤 − ${k} × ATR = ${stopLoss}（策略卡沒有停損規則，這是每筆必設停損的要求，不會移動）`
      : `停損 = 收盤 − ${k} × ATR = ${stopLoss}${regime && regime.row.stopAtr !== resolveParams(strategy.template, strategy.params).atrStop ? `（局勢「${regime.label}」的停損寬度）` : ''}`
    out.push({ ...base, kind: 'enter', side: 'buy', shares: size.shares, stopLoss, basis: [stopNote, ...size.basis] })
  }
  return out
}

export interface OrderCheck {
  level: PlanAdvice['level']
  text: string
  passed: boolean
}

export interface OrderCheckInput {
  side: 'buy' | 'sell'
  price: number
  shares: number
  stopLoss?: number
  // The date of the price the order is based on.
  date: string
  today: string
  account: PaperAccount
  policy: InvestmentPolicy
  strategy?: TradingStrategy
  backtestPassed: boolean
  regime?: RegimeContext | null
  // Every paper account and the cash pool, for the trading capital; this
  // account alone if absent.
  accounts?: PaperAccount[]
  funds?: PaperFunds
}

// Before a paper order: required checks block it, the rest only advise.
export function orderChecks(input: OrderCheckInput): OrderCheck[] {
  const { side, price, shares, stopLoss, date, today, account, policy, strategy, regime } = input
  const out: OrderCheck[] = []
  const age = date ? Math.floor((Date.parse(today) - Date.parse(date)) / 86400000) : Infinity
  out.push({ level: 'required', text: age <= STALE_DAYS ? `價格是最近的收盤（${date}）` : `價格太舊（${date || '沒有日期'}），請先更新收盤價`, passed: age <= STALE_DAYS })
  if (side === 'sell') return out
  const sleeve = sleeveOf(others(account, input.accounts), account.market, input.funds)
  const hasStop = stopLoss !== undefined && stopLoss > 0 && stopLoss < price
  out.push({ level: 'required', text: hasStop ? `已設停損 ${stopLoss}` : '買進必須設停損，且低於買進價', passed: hasStop })
  if (hasStop) {
    const limit = riskLimitOf(strategy, policy)
    const capital = sleeve.capital
    const risk = shares * (price - stopLoss!)
    const share = capital > 0 ? (risk / capital) * 100 : Infinity
    const ok = share <= limit.percent + 0.005
    out.push({ level: 'required', text: `停損風險 ${money(risk)}，占總資金 ${share.toFixed(2)}%（上限 ${limit.percent}%，${limit.source}）`, passed: ok })
    const open = capital > 0 ? ((sleeve.openRisk + risk) / capital) * 100 : Infinity
    out.push({
      level: 'required',
      text: `下單後全部策略的未平倉停損風險 ${open.toFixed(1)}%（上限 ${OPEN_RISK_LIMIT_PERCENT}%${sleeve.unstopped > 0 ? `；${sleeve.unstopped} 檔沒設停損，未計入` : ''}）`,
      passed: open <= OPEN_RISK_LIMIT_PERCENT + 0.005,
    })
  }
  const cost = shares * price * 1.002
  out.push({ level: 'required', text: cost <= sleeve.cash ? `現金足夠（需約 ${money(cost)}）` : `現金不足：需約 ${money(cost)}，可用 ${money(sleeve.cash)}`, passed: cost <= sleeve.cash && shares > 0 })
  if (strategy) {
    out.push({
      level: 'suggest',
      text: input.backtestPassed ? '策略卡已通過回測' : '這張卡還沒有通過回測：虛擬交易的結果不能用來解鎖實單',
      passed: input.backtestPassed,
    })
    const method = METHOD_OF[strategy.template] ?? 'other'
    if (regime && !allows(regime, method)) {
      out.push({ level: 'notice', text: `目前局勢「${regime.label}」不允許${ENTRY_METHOD_LABELS[method]}新建倉；實單會被擋下，虛擬交易可照練但請記下`, passed: false })
    }
  }
  return out
}

export const blocked = (checks: OrderCheck[]) => checks.some((c) => c.level === 'required' && !c.passed)

const sameItem = (a: AssistantItem, b: AssistantItem) => a.symbol === b.symbol && a.kind === b.kind

// Saves a new set of suggestions. On the same price date, outcomes already
// recorded carry over; on a new date, the old actionable ones go to the
// log, untouched ones as missed.
export function withSnapshot(account: PaperAccount, items: AssistantItem[], generatedAt: string): PaperAccount {
  const prev = account.assistant
  const date = items.map((i) => i.date).filter(Boolean).sort().pop() ?? generatedAt.slice(0, 10)
  if (prev && prev.date === date) {
    const merged = items.map((i) => {
      const old = prev.items.find((o) => sameItem(o, i))
      return old && old.outcome !== 'pending' ? { ...i, outcome: old.outcome, note: old.note } : i
    })
    return { ...account, assistant: { date, generatedAt, items: merged } }
  }
  const retired = (prev?.items ?? []).filter((i) => ACTIONABLE.includes(i.kind)).map((i) => (i.outcome === 'pending' ? { ...i, outcome: 'missed' as const } : i))
  return { ...account, assistant: { date, generatedAt, items }, signalLog: [...account.signalLog, ...retired].slice(-MAX_LOG) }
}

export function resolveItem(account: PaperAccount, symbol: string, kind: AssistantKind, outcome: SignalOutcome, note?: string): PaperAccount {
  if (!account.assistant) return account
  return {
    ...account,
    assistant: { ...account.assistant, items: account.assistant.items.map((i) => (i.symbol === symbol && i.kind === kind ? { ...i, outcome, note } : i)) },
  }
}

export interface Execution {
  counts: Record<SignalOutcome, number>
  // Followed or modified, out of the suggestions already decided or missed.
  rate: number | null
  // Skipped and modified ones with their reasons, newest first, for the weekly review.
  notes: AssistantItem[]
}

export function executionOf(account: PaperAccount): Execution {
  const items = [...account.signalLog, ...(account.assistant?.items ?? []).filter((i) => ACTIONABLE.includes(i.kind))]
  const counts: Record<SignalOutcome, number> = { pending: 0, followed: 0, modified: 0, skipped: 0, missed: 0 }
  for (const i of items) counts[i.outcome] += 1
  const decided = counts.followed + counts.modified + counts.skipped + counts.missed
  return {
    counts,
    rate: decided > 0 ? (counts.followed + counts.modified) / decided : null,
    notes: items.filter((i) => i.outcome === 'skipped' || i.outcome === 'modified').reverse(),
  }
}

const daysBetween = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86400000)

const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

// The past week's draft for the weekly review (handbook 10 §7), from
// the suggestions and fills alone: the trader adds what to change.
export function weeklyReview(account: PaperAccount, today: string): string[] {
  const inWeek = (date: string) => daysBetween(date, today) < 7
  const week = { ...account, signalLog: account.signalLog.filter((i) => inWeek(i.date)), assistant: account.assistant && inWeek(account.assistant.date) ? account.assistant : undefined }
  const ex = executionOf(week)
  const c = ex.counts
  const lines = [`助手建議 ${c.followed + c.modified + c.skipped + c.missed + c.pending} 筆：照做 ${c.followed}、修改 ${c.modified}、略過 ${c.skipped}、未處理 ${c.missed}、待處理 ${c.pending}，執行率 ${pctText(ex.rate)}`]
  for (const n of ex.notes) lines.push(`${n.date} ${formatSymbol(n.symbol)} ${ASSISTANT_KIND_LABELS[n.kind]}・${OUTCOME_LABELS[n.outcome]}${n.note ? `：${n.note}` : ''}`)
  const missed = [...week.signalLog].filter((i) => i.outcome === 'missed')
  if (missed.length > 0) lines.push(`沒按也沒略過：${missed.map((i) => `${i.date} ${formatSymbol(i.symbol)} ${ASSISTANT_KIND_LABELS[i.kind]}`).join('、')}`)
  const fills = account.orders.filter((o) => o.status === 'filled' && o.filledAt && inWeek(o.filledAt.slice(0, 10)))
  const manual = fills.filter((o) => !o.reason.startsWith('策略訊號') && !o.reason.startsWith('停損觸發'))
  const stops = fills.filter((o) => o.reason.startsWith('停損觸發'))
  lines.push(`成交 ${fills.length} 筆：依助手 ${fills.length - manual.length - stops.length}、停損觸發 ${stops.length}、手動 ${manual.length}`)
  for (const o of manual) lines.push(`手動${o.side === 'buy' ? '買進' : '賣出'} ${formatSymbol(o.symbol)}：${o.reason || '（沒寫理由）'}`)
  const r = fills.filter((o) => o.rMultiple !== undefined).map((o) => o.rMultiple!)
  if (r.length > 0) lines.push(`已實現 ${r.length} 筆，平均 ${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(2)}R`)
  return lines
}

// Paper accounts on the day's list (handbook 04 §0), from what is saved:
// suggestions not yet acted on, stops to raise or watch, and prices or
// suggestions that are out of date. Marked 虛擬 to keep them apart from
// real money.
export function paperScanItems(accounts: PaperAccount[], strategies: TradingStrategy[], today: string, weeklyDecisionDay = 5): ScanItem[] {
  const out: ScanItem[] = []
  const weekday = ![0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay())
  for (const a of accounts) {
    const card = strategies.find((s) => s.id === a.strategyId)
    if (!card || card.status !== 'paper') continue
    const to = `/sim/paper?account=${encodeURIComponent(a.id)}`
    const tag = a.name.includes('虛擬') ? a.name : `虛擬・${a.name}`
    const basis = `策略卡「${card.name}」進出場助手`
    const snap = a.assistant
    const fresh = snap && daysBetween(snap.date, today) <= STALE_DAYS
    const items = fresh ? snap.items : []
    for (const i of items.filter((x) => x.outcome === 'pending')) {
      const sym = formatSymbol(i.symbol)
      if (i.kind === 'stop_hit') out.push(scanItem('stop_hit', `${tag}：${sym} 收盤跌破停損，更新收盤價以觸發賣出`, basis, to, 'suggest'))
      else if (i.kind === 'raise_stop') out.push(scanItem('raise_stop', `${tag}：${sym} 停損上調到 ${i.raiseTo}`, basis, to))
      else if (i.kind === 'near_stop') out.push(scanItem('raise_stop', `${tag}：${sym} 接近停損，不要下移停損`, basis, to, 'notice'))
    }
    const orders = items.filter((x) => x.outcome === 'pending' && (x.kind === 'enter' || x.kind === 'exit'))
    if (orders.length > 0) {
      const list = orders.map((x) => `${ASSISTANT_KIND_LABELS[x.kind]} ${formatSymbol(x.symbol)}`).join('、')
      out.push(scanItem('entry_signal', `${tag}：${orders.length} 筆建議待處理（${list}）`, `${basis}（${snap!.date} 收盤）`, to))
    }
    const priced = a.positions.map((p) => p.lastPriceDate).sort()[0]
    if (priced && daysBetween(priced, today) > 3) {
      out.push(scanItem('housekeeping', `${tag}：持倉價格停在 ${priced}，收盤後更新收盤價`, '更新收盤價才會觸發停損與限價單', to))
    }
    const generated = snap?.generatedAt.slice(0, 10) ?? ''
    if (cadenceOf(card.template, card.cadence) === 'weekly') {
      // Weekly: once on the decision day (or later that week until done);
      // other weekdays only the stops, when something is held.
      const day = card.decisionDay ?? weeklyDecisionDay
      if (generated < lastDecisionDate(today, day)) {
        out.push(scanItem('housekeeping', `${tag}：${WEEKDAY_LABELS[day]}收盤後產生本週建議`, '手冊 10 §6.6：週頻策略每週在判斷日檢查一次', to))
      } else if (weekday && a.positions.length > 0 && generated < today) {
        out.push(scanItem('housekeeping', `${tag}：收盤後執行例行，檢查停損`, '週頻只在判斷日決定進出場，停損每天照常', to, 'notice'))
      }
    } else if (weekday && generated < today) {
      out.push(scanItem('housekeeping', `${tag}：收盤後產生今日建議`, '手冊 10 §7：每個交易日照策略卡檢查一次', to))
    }
  }
  return out
}

export interface ItemExplanation {
  // What to do, in one sentence (the conclusion).
  action: string
  // The numbers behind it, at most four.
  numbers: { label: string; value: string }[]
  // Which button to press, or why nothing needs doing.
  todo: string
}

const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`

// One suggestion in plain words (docs/ui-guidelines.md §3): the action,
// its money and risk, and the next step.
export function explainItem(item: AssistantItem, account: PaperAccount, accounts?: PaperAccount[], funds?: PaperFunds): ItemExplanation {
  const sym = formatSymbol(item.symbol)
  const capital = sleeveOf(others(account, accounts), account.market, funds).capital
  const p = account.positions.find((x) => x.symbol === item.symbol)
  const share = (v: number) => (capital > 0 ? `總資金 ${pct(v / capital)}` : '')
  const pnl = p ? (item.close - p.avgCost) * p.shares : 0
  const position = p ? [{ label: '目前損益', value: `${signedMoney(pnl)}（${pct((item.close - p.avgCost) / p.avgCost)}）` }] : []
  switch (item.kind) {
    case 'enter': {
      if (!item.shares || item.stopLoss === undefined) return { action: `${sym} 觸發進場，但無法計算股數`, numbers: [], todo: 'ATR 資料不足：等資料足夠再產生建議，或按「略過」。' }
      const cost = item.shares * item.close
      const risk = item.shares * (item.close - item.stopLoss)
      return {
        action: `買進 ${sym} ${item.shares.toLocaleString()} 股，約 ${money(cost)} 元`,
        numbers: [
          { label: '停損', value: `${item.stopLoss}（−${pct((item.close - item.stopLoss) / item.close)}）` },
          { label: '停損時虧損', value: `${money(risk)} 元（${share(risk)}）` },
          { label: '部位', value: share(cost) },
        ],
        todo: '確認股數與停損後按「依建議下單」；不買就按「略過」並寫一句理由。',
      }
    }
    case 'exit':
      return { action: `賣出 ${sym} 全部 ${item.shares?.toLocaleString() ?? ''} 股`, numbers: position, todo: '策略的出場條件成立：按「依建議賣出」，不要等反彈。' }
    case 'stop_hit':
      return {
        action: `${sym} 收盤 ${item.close} 已跌破停損 ${p?.stopLoss ?? ''}`,
        numbers: position,
        todo: '按「更新收盤價並產生建議」讓停損單成交賣出；不要為了不賣而下移停損。',
      }
    case 'raise_stop': {
      const to = item.raiseTo ?? 0
      const locked = p ? (to - p.avgCost) * p.shares : 0
      return {
        action: p?.stopLoss === undefined ? `替 ${sym} 設停損 ${to}` : `把 ${sym} 的停損從 ${p.stopLoss} 上調到 ${to}`,
        numbers: [{ label: '離收盤', value: `−${pct((item.close - to) / item.close)}` }, { label: locked >= 0 ? '停損時鎖住獲利' : '停損時虧損', value: `${money(Math.abs(locked))} 元` }, ...position],
        todo: `按「套用停損 ${to}」；停損只往上調，不往下移。`,
      }
    }
    case 'near_stop':
      return {
        action: `${sym} 離停損 ${p?.stopLoss ?? ''} 只剩 ${p?.stopLoss ? pct((item.close - p.stopLoss) / item.close) : ''}`,
        numbers: position,
        todo: '不用下單。不要下移停損：觸及就照規則出場。',
      }
    case 'hold':
      return { action: `續抱 ${sym}`, numbers: position, todo: item.decidesOn ? `週頻：出場等 ${item.decidesOn.slice(5).replace('-', '/')} 收盤判斷；停損照常有效。` : '規則沒有出場訊號，什麼都不做。' }
    case 'wait':
      return { action: `觀望 ${sym}`, numbers: [], todo: item.decidesOn ? `週頻：進場要等 ${item.decidesOn.slice(5).replace('-', '/')} 收盤判斷，今天不下單。` : '還沒觸發進場條件。' }
    case 'no_data':
      return { action: `${sym} 無法判斷`, numbers: [], todo: '價格資料不足，先更新收盤價或檢查代號。' }
  }
}

// The day in one sentence: what needs doing, then what does not.
export function adviceSummary(items: AssistantItem[]): { headline: string; detail: string; actionable: number } {
  const count = (k: AssistantKind) => items.filter((i) => i.kind === k).length
  const parts = (['stop_hit', 'exit', 'enter', 'raise_stop'] as AssistantKind[]).filter((k) => count(k) > 0).map((k) => `${ASSISTANT_KIND_LABELS[k]} ${count(k)}`)
  const pending = items.filter((i) => ['stop_hit', 'exit', 'enter', 'raise_stop'].includes(i.kind) && i.outcome === 'pending').length
  const actionable = parts.length > 0 ? items.filter((i) => ['stop_hit', 'exit', 'enter', 'raise_stop'].includes(i.kind)).length : 0
  const rest = [count('near_stop') > 0 && `接近停損 ${count('near_stop')}`, count('hold') > 0 && `續抱 ${count('hold')}`, count('wait') > 0 && `觀望 ${count('wait')}`, count('no_data') > 0 && `無法判斷 ${count('no_data')}`].filter(Boolean).join('、')
  const decidesOn = items.find((i) => i.decidesOn)?.decidesOn
  const weekly = decidesOn ? `週頻：進出場等 ${decidesOn.slice(5).replace('-', '/')} 收盤判斷，今天只檢查停損。` : ''
  return {
    headline: actionable === 0 ? '今天沒有要下單或調整的事' : pending === 0 ? `今天的 ${actionable} 件事都處理完了` : `今天有 ${pending} 件事要處理（${parts.join('、')}）`,
    detail: [weekly, rest ? `其餘：${rest}。照規則什麼都不做，也是一種紀律。` : ''].filter(Boolean).join(''),
    actionable,
  }
}

// The entry and exit prices of one symbol under the card's rules
// (handbook 10 §7): what the next deciding close must reach, each with its
// distance from the latest close, plus the stop. Weekly cards decide at the
// decision day's close.
export interface PriceLevelText {
  entry: string
  exit: string
}

export function priceLevels(item: AssistantItem, account: PaperAccount): PriceLevelText {
  const c = item.close
  const dist = (v: number) => `${v >= c ? '+' : '−'}${pct(Math.abs(v / c - 1))}`
  const away = (v: number) => `（${dist(v)}）`
  const when = item.decidesOn ? `${item.decidesOn.slice(5).replace('-', '/')} 收盤` : '收盤'
  const side = (s: { above?: number; below?: number; note?: string } | undefined): string[] => {
    if (!s) return []
    const price =
      s.above !== undefined && s.below !== undefined
        ? `${when}介於 ${s.above}～${s.below}（${dist(s.above)}～${dist(s.below)}）`
        : s.above !== undefined
          ? `${when} > ${s.above}${away(s.above)}`
          : s.below !== undefined
            ? `${when} < ${s.below}${away(s.below)}`
            : ''
    return [price, s.note ?? ''].filter(Boolean)
  }
  // Not held yet: the card's exit line only matters once bought, and is
  // left out when it is the entry price itself (crossing back).
  const entryLv = item.levels?.entry
  const exitLv = item.levels?.exit
  const sameLine = !!exitLv && !!entryLv && exitLv.below !== undefined && exitLv.below === entryLv.above
  const p = account.positions.find((x) => x.symbol === item.symbol)
  const stop = p?.stopLoss ?? item.stopLoss
  const stopText = p
    ? stop !== undefined
      ? `停損 ${stop}${away(stop)}`
      : '還沒設停損'
    : item.stopLoss !== undefined
      ? `停損 ${item.stopLoss}${away(item.stopLoss)}`
      : item.stopEstimate !== undefined
        ? `買進後停損約 ${item.stopEstimate}${away(item.stopEstimate)}`
        : ''

  const entry =
    item.kind === 'enter'
      ? `今天收盤 ${c} 已觸發，${item.decidesOn ? '下個交易日開盤' : '依收盤價'}買進`
      : p
        ? '已持有'
        : side(item.levels?.entry).join('；') || '—'
  const strategyExit = side(exitLv).join('，')
  const exit =
    item.kind === 'exit'
      ? '出場條件已成立，全部賣出'
      : p || item.kind === 'enter'
        ? [strategyExit, stopText].filter(Boolean).join('・') || '—'
        : [stopText, !sameLine && strategyExit ? `持有後：${strategyExit}` : ''].filter(Boolean).join('・') || '—'
  return { entry, exit }
}
