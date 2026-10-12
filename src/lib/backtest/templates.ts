import type { StrategyStatus, StrategyTemplate } from '../storage/schema'

export const STRATEGY_STATUS_LABELS: Record<StrategyStatus, string> = {
  dev: '開發中',
  paper: '虛擬交易',
  live: '實單',
  retired: '停用',
}

export interface TemplateParam {
  key: string
  label: string
  default: number
  min: number
  max: number
  step: number
}

export interface TemplateDefinition {
  label: string
  // Where the approach comes from (handbook chapter 10, appendix A).
  origin: string
  summary: string
  entry: string
  exit: string
  params: TemplateParam[]
  // Momentum rotation picks among several symbols; the rest trade each
  // symbol on its own.
  multiSymbol: boolean
  // Templates the backtester can run (discretionary is a written plan only).
  backtestable: boolean
}

const p = (key: string, label: string, def: number, min: number, max: number, step = 1): TemplateParam => ({
  key,
  label,
  default: def,
  min,
  max,
  step,
})

export const STRATEGY_TEMPLATES: Record<StrategyTemplate, TemplateDefinition> = {
  buy_hold: {
    label: '買進持有',
    origin: '基準（柏格）',
    summary: '第一天全部買進，一直持有。所有策略都要和它比。',
    entry: '第一個交易日全額買進',
    exit: '不出場',
    params: [],
    multiSymbol: false,
    backtestable: true,
  },
  dca: {
    label: '定期定額',
    origin: '核心配置',
    summary: '每月固定金額買進，核心 ETF 的長期投入方式。',
    entry: '每月第一個交易日投入固定金額',
    exit: '不出場',
    params: [p('monthlyAmount', '每月投入金額', 10000, 1000, 1000000, 1000)],
    multiSymbol: false,
    backtestable: true,
  },
  ma_cross: {
    label: '均線交叉',
    origin: '趨勢追蹤',
    summary: '短期均線在長期均線之上持有，跌破就出場，躲開長期空頭。',
    entry: '收盤時短期均線向上穿越長期均線，隔日開盤買進',
    exit: '短期均線向下穿越長期均線，或觸及 ATR 停損',
    params: [
      p('fast', '短期均線（日）', 20, 5, 100),
      p('slow', '長期均線（日）', 120, 20, 300),
      p('atrStop', '停損：ATR 倍數（0 不設）', 3, 0, 10, 0.5),
    ],
    multiSymbol: false,
    backtestable: true,
  },
  donchian: {
    label: '唐奇安通道突破',
    origin: '海龜交易法',
    summary: '創 N 日新高進場、跌破 M 日新低出場，讓獲利奔跑、虧損截短。',
    entry: '收盤價突破前 N 日最高價，隔日開盤買進',
    exit: '收盤價跌破前 M 日最低價，或觸及 ATR 停損',
    params: [
      p('entryDays', '進場：突破 N 日高', 55, 10, 250),
      p('exitDays', '出場：跌破 M 日低', 20, 5, 120),
      p('atrStop', '停損：ATR 倍數（0 不設）', 2, 0, 10, 0.5),
    ],
    multiSymbol: false,
    backtestable: true,
  },
  rsi_reversion: {
    label: 'RSI 均值回歸',
    origin: '康納斯短線回檔',
    summary: '只在長期多頭（價格在長期均線之上）時，買進短線超賣的回檔。',
    entry: '收盤價在長期均線之上，且 RSI 低於進場門檻，隔日開盤買進',
    exit: 'RSI 高於出場門檻、持有超過上限天數，或觸及 ATR 停損',
    params: [
      p('rsiDays', 'RSI 天數', 14, 2, 30),
      p('trendDays', '長期均線（日）', 200, 50, 300),
      p('entryBelow', '進場：RSI 低於', 30, 5, 50),
      p('exitAbove', '出場：RSI 高於', 55, 40, 90),
      p('maxHoldDays', '最長持有（日）', 20, 3, 120),
      p('atrStop', '停損：ATR 倍數（0 不設）', 3, 0, 10, 0.5),
    ],
    multiSymbol: false,
    backtestable: true,
  },
  momentum_rotation: {
    label: '動能輪動',
    origin: '安東納奇雙動能',
    summary: '每月把資金放在過去 N 個月漲最多的前 K 檔；全部都下跌時改持現金。',
    entry: '每月第一個交易日，依過去 N 個月報酬排序，等權買進前 K 名',
    exit: '下次調整時跌出前 K 名，或絕對動能轉負（N 個月報酬 < 0）',
    params: [
      p('lookbackMonths', '動能期間（月）', 12, 1, 24),
      p('topK', '持有前 K 名', 1, 1, 5),
      p('absoluteFilter', '絕對動能濾網（1 開／0 關）', 1, 0, 1),
    ],
    multiSymbol: true,
    backtestable: true,
  },
  discretionary: {
    label: '自訂（文字規則）',
    origin: '個人交易計畫',
    summary: '無法用範本表達的策略，例如基本面選股或事件交易；只寫交易計畫，不能自動回測。',
    entry: '',
    exit: '',
    params: [],
    multiSymbol: false,
    backtestable: false,
  },
}

export function defaultParams(template: StrategyTemplate): Record<string, number> {
  return Object.fromEntries(STRATEGY_TEMPLATES[template].params.map((x) => [x.key, x.default]))
}

// Stored params may predate a template change; fill gaps with defaults.
export function resolveParams(template: StrategyTemplate, params: Record<string, number>): Record<string, number> {
  return { ...defaultParams(template), ...params }
}

// "TW:0050" → { market: 'TW', code: '0050' }. Bare codes default to TW.
export function parseSymbol(symbol: string): { market: 'TW' | 'US'; code: string } {
  const [a, b] = symbol.includes(':') ? symbol.split(':') : ['TW', symbol]
  return { market: a.toUpperCase() === 'US' ? 'US' : 'TW', code: b.trim().toUpperCase() }
}

export function formatSymbol(symbol: string): string {
  const { market, code } = parseSymbol(symbol)
  return market === 'TW' ? code : `${code}（美）`
}

// Free text "0050, 2330, US:SPY" → normalized keys.
export function parseSymbolList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          const { market, code } = parseSymbol(t)
          return `${market}:${code}`
        }),
    ),
  ]
}
