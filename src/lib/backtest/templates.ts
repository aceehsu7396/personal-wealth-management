import type { StrategyStatus, StrategyTemplate } from '../storage/schema'

export const STRATEGY_STATUS_LABELS: Record<StrategyStatus, string> = {
  dev: '開發中',
  paper: '虛擬交易',
  live: '實單',
  retired: '停用',
}

// How to choose a parameter (handbook chapter 10 §6.1, appendix D4).
export interface ParamHelp {
  meaning: string
  // What raising or lowering the value trades off.
  higher: string
  lower: string
  // Common values and where the default comes from.
  typical: string
  pitfall: string
}

export interface TemplateParam {
  key: string
  label: string
  default: number
  min: number
  max: number
  step: number
  help: ParamHelp
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

const p = (key: string, label: string, def: number, min: number, max: number, step: number, help: ParamHelp): TemplateParam => ({
  key,
  label,
  default: def,
  min,
  max,
  step,
  help,
})

// The ATR stop is shared by the trend and reversion templates.
const atrStopHelp = (typical: string): ParamHelp => ({
  meaning: '停損放在進場價下方「ATR × 倍數」的位置。ATR 是近 14 日平均每日波動幅度，波動大的標的停損自動放寬。',
  higher: '倍數越大停損越遠：較少被正常波動洗出場，但每次停損賠得多；用風險部位法時，同樣風險只能買較少股數。',
  lower: '倍數越小停損越近：每次賠得少、可買較多股數，但容易被雜訊洗掉，勝率下降、交易成本上升。',
  typical,
  pitfall: '設 0 等於不設停損，回測看起來可能更好（躲過被洗），但實單一次大跌就可能超過每筆風險上限；投資政策要求停損時不建議設 0。',
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
    params: [
      p('monthlyAmount', '每月投入金額', 10000, 1000, 1000000, 1000, {
        meaning: '每月第一個交易日固定投入的金額，不看價格高低。',
        higher: '金額越大，最終資產越多，但報酬率（%）幾乎不變；要確認現金流負擔得起。',
        lower: '金額越小越容易長期持續，但累積速度慢。',
        typical: '依財務地基試算的「每月可投資金額」，通常是收入扣除生活費與緊急預備金提撥後的 50～80%。',
        pitfall: '定期定額的回測報酬率不受金額影響；不要為了回測好看而調金額，它是現金流決定的，不是最佳化的參數。',
      }),
    ],
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
      p('fast', '短期均線（日）', 20, 5, 100, 1, {
        meaning: '最近 N 日收盤價的平均，代表短期趨勢；它向上穿越長期均線就進場。',
        higher: '天數越多，越平滑、假訊號越少，但進出場越慢，會錯過趨勢的開頭與結尾。',
        lower: '天數越少，反應越快，但盤整時頻繁進出（被「雙巴」），手續費與證交稅吃掉報酬。',
        typical: '常見 10、20（約一個月）、50。預設 20 日是月線，台股慣用。必須明顯小於長期均線，通常是它的 1/6～1/3。',
        pitfall: '不要逐日微調找最高報酬；看參數敏感度與單一參數掃描，附近數值都不錯才算穩健。',
      }),
      p('slow', '長期均線（日）', 120, 20, 300, 1, {
        meaning: '最近 N 日收盤價的平均，代表中長期趨勢方向，用來判斷多頭或空頭。',
        higher: '天數越多（例如 200 日），只抓大趨勢、交易次數少、能避開長期空頭，但轉折時反應很慢。',
        lower: '天數越少，進出場較頻繁，較接近波段操作。',
        typical: '120 日約半年（半年線），200 日是國際常用的長期多空分界。預設 20／120 是台股常見的月線與半年線組合。',
        pitfall: '樣本期間太短（少於 5 年）時，長均線的交叉只有幾次，結果不具統計意義；交易次數少於 20 筆要特別保守。',
      }),
      p('atrStop', '停損：ATR 倍數（0 不設）', 3, 0, 10, 0.5, atrStopHelp('趨勢策略常用 2～4 倍；預設 3 倍，讓趨勢有空間波動。')),
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
      p('entryDays', '進場：突破 N 日高', 55, 10, 250, 1, {
        meaning: '收盤價創過去 N 日新高時進場，代表價格突破整理區，可能展開新趨勢。',
        higher: '天數越多，只追真正的大突破，訊號少、假突破少，但進場價較高。',
        lower: '天數越少，進場較早較頻繁，但假突破多，勝率低。',
        typical: '海龜交易法的兩套系統：20 日（短）與 55 日（長）。預設 55 日，適合中長期。',
        pitfall: '突破策略勝率常只有 30～40%，靠少數大賺彌補多次小賠；不要因為勝率低就加濾網，先看獲利因子與期望值。',
      }),
      p('exitDays', '出場：跌破 M 日低', 20, 5, 120, 1, {
        meaning: '收盤價跌破過去 M 日最低價時出場，是「移動停利」：價格上漲時出場點也跟著上移。',
        higher: '天數越多，給趨勢更大回檔空間，抱得更久，但出場時回吐的獲利較多。',
        lower: '天數越少，鎖住獲利較快，但容易在正常回檔時就被洗出場。',
        typical: '海龜交易法：55 日進場配 20 日出場、20 日進場配 10 日出場。出場天數通常是進場天數的 1/3～1/2。',
        pitfall: '出場天數若大於進場天數，等於很難出場、接近買進持有，失去控制回撤的目的。',
      }),
      p('atrStop', '停損：ATR 倍數（0 不設）', 2, 0, 10, 0.5, atrStopHelp('海龜交易法用 2 倍 ATR（2N）停損；預設 2 倍。')),
    ],
    multiSymbol: false,
    backtestable: true,
  },
  rsi_reversion: {
    label: 'RSI 均值回歸',
    origin: '康納斯短線回檔',
    summary: '只在長期多頭（價格在長期均線之上）時，買進短線超賣的回檔。持倉時間通常只有 1～2 成，適合運用閒置現金，報酬不要和全額持有直接比。',
    entry: '收盤價在長期均線之上，且 RSI 低於進場門檻，隔日開盤買進',
    exit: 'RSI 高於出場門檻、持有超過上限天數，或觸及 ATR 停損',
    params: [
      p('rsiDays', 'RSI 天數', 2, 2, 30, 1, {
        meaning: '相對強弱指標的計算天數。RSI 介於 0～100，越低代表近期跌得越兇（超賣）。',
        higher: '天數越多，RSI 越平滑，很少跌到極端值，訊號變少。',
        lower: '天數越少，RSI 波動越劇烈，常碰到超賣，訊號多、持有期短。',
        typical: '預設 2 日，採用康納斯的短線回檔設定，搭配低於 10 進場。威爾德原始設定是 14 日，但 14 日 RSI 在 200 日線之上很少跌破 30，10 年只會交易幾次；改用 14 日時，進場門檻要提高到 35～40。',
        pitfall: 'RSI 天數與進場門檻要一起看：14 日 RSI 很少低於 20，2 日 RSI 常低於 10。只改其中一個，訊號數量可能變得極多或極少。',
      }),
      p('trendDays', '長期均線（日）', 200, 50, 300, 1, {
        meaning: '濾網：只在收盤價高於這條均線（長期多頭）時才買超賣回檔，避免在空頭中接刀。',
        higher: '天數越多，濾網越寬鬆穩定，只排除真正的長期空頭。',
        lower: '天數越少，濾網越嚴格且反覆，可能錯過多頭中的深回檔。',
        typical: '200 日是國際通用的長期多空分界，康納斯的策略也用 200 日。',
        pitfall: '拿掉濾網（設很短）時，回測可能因為某次 V 型反彈而好看，但空頭時會連續停損。',
      }),
      p('entryBelow', '進場：RSI 低於', 10, 2, 50, 1, {
        meaning: 'RSI 跌破這個值才買進，數值越低代表要跌得越深才進場。',
        higher: '門檻越高（例如 40），訊號越多但回檔較淺，反彈空間小。',
        lower: '門檻越低（例如 20），訊號少但都是深度超賣，反彈機率與幅度較大。',
        typical: '2 日 RSI 常用 5～10（預設 10）；14 日 RSI 常用 30，但搭配 200 日線濾網時很少觸發。',
        pitfall: '門檻太低時，幾年才一次訊號，交易次數不足 20 筆，回測結果多半是運氣。',
      }),
      p('exitAbove', '出場：RSI 高於', 70, 40, 95, 1, {
        meaning: 'RSI 回升到這個值就出場，代表回檔已修復。',
        higher: '門檻越高，抱得越久、單筆賺得多，但可能等不到而由最長持有天數或停損出場。',
        lower: '門檻越低，快進快出、勝率高、單筆賺得少。',
        typical: '2 日 RSI 常在回到 65～75 時出場（預設 70）；14 日 RSI 則常用 50～55。',
        pitfall: '均值回歸的本質是賺小反彈；把出場門檻拉高去抓趨勢，策略性質就變了，要另寫一張策略卡。',
      }),
      p('maxHoldDays', '最長持有（日）', 10, 3, 120, 1, {
        meaning: '持有超過這個交易日數，不管 RSI 都出場，避免資金被卡在不反彈的部位。',
        higher: '天數越多，給反彈更多時間，但資金使用效率下降。',
        lower: '天數越少，資金周轉快，但可能在反彈前就出場。',
        typical: '短線回檔策略通常 5～20 日；預設 10 日（約兩週），2 日 RSI 的反彈多半在一週內完成。',
        pitfall: '若多數交易都是「持有逾期」出場，代表進場訊號不夠準，不是天數的問題。',
      }),
      p('atrStop', '停損：ATR 倍數（0 不設）', 3, 0, 10, 0.5, atrStopHelp('均值回歸本來就在下跌中買進，停損要比趨勢策略寬，常用 3 倍以上；預設 3 倍。')),
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
      p('lookbackMonths', '動能期間（月）', 12, 1, 24, 1, {
        meaning: '用過去幾個月的報酬排名，買進最強的標的（相對動能）。',
        higher: '期間越長，排名越穩定、換手少，但轉換慢。',
        lower: '期間越短，換手頻繁、對短期雜訊敏感，交易成本高。',
        typical: '學術研究最常見 12 個月（常排除最近 1 個月）；安東納奇的雙動能用 12 個月。3～12 個月都有文獻支持。',
        pitfall: '標的少（2～3 檔）時，不同期間的結果差異很大；用單一參數掃描確認 6～12 個月都不錯再採用。',
      }),
      p('topK', '持有前 K 名', 1, 1, 5, 1, {
        meaning: '每月等權持有排名前 K 檔。',
        higher: 'K 越大越分散、波動越低，但報酬向平均靠攏。',
        lower: 'K = 1 最集中，報酬與回撤都最極端。',
        typical: '標的 2～4 檔時用 1；標的 5 檔以上可用 2～3。K 不可大於標的數。',
        pitfall: 'K 等於標的數時，就是等權持有全部，動能排序失去作用。',
      }),
      p('absoluteFilter', '絕對動能濾網（1 開／0 關）', 1, 0, 1, 1, {
        meaning: '開啟時，若排名第一的標的過去 N 個月報酬也是負的，就全部改持現金。',
        higher: '開啟（1）：可避開長期空頭（例如 2008、2022），代價是反彈初期常常還在現金。',
        lower: '關閉（0）：永遠持有最強的標的，空頭時跟著跌。',
        typical: '雙動能的核心就是相對加絕對動能，預設開啟。',
        pitfall: '樣本期間若沒有經歷過空頭，濾網看起來只會拖累報酬；判斷時要用包含空頭的期間。',
      }),
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

export interface SettingHelp {
  meaning: string
  howToChoose: string
  pitfall: string
}

// Backtest settings other than the template's own parameters.
export const BACKTEST_SETTING_HELP: Record<'period' | 'capital' | 'fees' | 'sizing' | 'risk' | 'oos', SettingHelp> = {
  period: {
    meaning: '回測使用的歷史區間；開始日之前會多抓資料讓均線先算好。',
    howToChoose: '至少 5 年，最好包含一次空頭（台股 2015、2018、2020、2022）與一次多頭，才看得出策略在不同環境的表現。',
    pitfall: '只挑多頭期間會讓所有做多策略都很好看；改期間找最佳結果也是一種過度最佳化。',
  },
  capital: {
    meaning: '起始資金，用來計算股數與最低手續費。',
    howToChoose: '用你實際打算投入這個策略的金額，也就是交易部位 × 這個策略的分配比例。',
    pitfall: '資金太小時，高價股買不到一張、最低手續費 20 元占比高，結果會比實際差。',
  },
  fees: {
    meaning: '台股手續費 0.1425% 乘上券商折扣（最低 20 元），賣出另課證交稅：股票 0.3%、ETF 0.1%。',
    howToChoose: '填你券商的實際折扣（例如 2.8 折填 0.28）。不確定時用 1 偏保守。',
    pitfall: '交易次數多的策略對成本很敏感；用 0 折扣測出來的報酬，實單一定做不到。',
  },
  sizing: {
    meaning: '等額：每個標的平均分配並全額投入。風險部位法：依 ATR 停損距離決定股數，讓每筆的最大虧損等於資金的固定比例。',
    howToChoose: '要和實單一致：實單會依每筆風險 1% 下單，就用風險部位法；只想比較進出場邏輯，用等額。',
    pitfall: '風險部位法常常不會全額投入，報酬較低但回撤也小；比較時要看夏普比率與最大回撤，不能只看報酬。',
  },
  risk: {
    meaning: '風險部位法下，每筆停損時賠掉資金的百分比。',
    howToChoose: '預設帶入策略卡的設定，策略卡又不能超過投資政策的上限（通常 1%）。新手 0.5～1%。',
    pitfall: '調高風險會等比例放大報酬與回撤；連續 10 次停損在 2% 風險下就是約 −18%。',
  },
  oos: {
    meaning: '把最後一段期間保留為「樣本外」：調參數時不看它，最後才用來驗證。',
    howToChoose: '常用 20～30%。期間 10 年時，30% 約是最後 3 年。',
    pitfall: '看過樣本外結果再回去改參數，樣本外就變成樣本內，驗證失效。設 0 時無法通過行動路線 4.2。',
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
