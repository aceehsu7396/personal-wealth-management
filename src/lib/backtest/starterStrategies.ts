import type { TradingStrategy } from '../storage/schema'

// Ready-made strategy cards for getting started: each comes with the edge
// it claims, rules, who it suits and its main risk. Applying one creates an
// ordinary strategy card in "開發中" that the user then backtests.

export interface StarterStrategy {
  id: string
  card: Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt' | 'status'>
  suits: string
  risk: string
}

export const STARTER_STRATEGIES: StarterStrategy[] = [
  {
    id: 'tw50-200d-filter',
    card: {
      name: '0050 趨勢濾網（200 日線）',
      template: 'ma_cross',
      params: { fast: 1, slow: 200, atrStop: 0 },
      symbols: ['TW:0050'],
      edge: '目的不是多賺，而是少賠：收盤站上 200 日線才持有，跌破就換成現金。長期空頭幾乎都發生在 200 日線之下，避開它們可以把最大回撤壓低約三分之一，報酬接近一直持有。',
      entryRules: '收盤價向上穿越 200 日均線，隔日開盤買進',
      exitRules: '收盤價跌破 200 日均線，隔日開盤賣出（不另設 ATR 停損：200 日線本身就是出場點）',
      riskPerTradePercent: 1,
      notes: '2015-10～2026-10 實測（手續費 2.8 折）：年化 19.0%、最大回撤 −21.3%；同期一直持有 0050 為 22.7%、−34.0%。報酬 ÷ 回撤 0.89 對 0.67。在 V 型反彈與盤整時會反覆進出（2018 年比持有多賠）。判斷時看「報酬 ÷ 回撤」與夏普比率，不要只看報酬。',
    },
    suits: '想降低大跌時的回撤、為全職後的提領期做準備',
    risk: '多頭時報酬會落後一直持有；盤整時會反覆小賠；跌破當天到隔日開盤之間仍可能有跳空',
  },
  {
    id: 'tw50-trend',
    card: {
      name: '0050 均線趨勢',
      template: 'ma_cross',
      params: { fast: 20, slow: 120, atrStop: 3 },
      symbols: ['TW:0050'],
      edge: '大盤的長期空頭通常伴隨均線下彎；跌破長期均線時退場，可避開大部分深跌，代價是盤整時來回小賠。',
      entryRules: '收盤 20 日均線向上穿越 120 日均線，隔日開盤買進',
      exitRules: '20 日均線跌破 120 日均線，或觸及 3 倍 ATR 停損',
      riskPerTradePercent: 1,
      notes: '最適合第一次回測：只有一個標的、規則簡單，容易和買進持有比較。',
    },
    suits: '第一次做回測、想降低大跌時的回撤',
    risk: '盤整期會多次小賠；長期報酬可能略低於一直持有',
  },
  {
    id: 'etf-dual-momentum',
    card: {
      name: '台股 ETF 雙動能輪動',
      template: 'momentum_rotation',
      params: { lookbackMonths: 12, topK: 1, absoluteFilter: 1 },
      symbols: ['TW:0050', 'TW:00646', 'TW:00635U', 'TW:00865B'],
      edge: '強勢資產在 3–12 個月內傾向延續（相對動能）；全部轉弱時退到現金（絕對動能），避開長期空頭（安東納奇雙動能）。',
      entryRules: '每月第一個交易日，持有過去 12 個月報酬最高的 1 檔（台股、美股、黃金、美國短債）',
      exitRules: '跌出第 1 名就換；全部 12 個月報酬為負時轉持現金',
      riskPerTradePercent: 1,
      notes: '00865B（美國短期公債）作為防守資產；四檔都在證交所上市，可以直接回測。',
    },
    suits: '想用少數幾檔 ETF 做資產配置輪動、每月只看一次',
    risk: '轉折時會晚一步；每月換倉的成本與稅要計入',
  },
  {
    id: 'turtle-breakout',
    card: {
      name: '大盤突破（海龜）',
      template: 'donchian',
      params: { entryDays: 55, exitDays: 20, atrStop: 2 },
      symbols: ['TW:0050'],
      edge: '創 55 日新高代表趨勢形成；讓獲利奔跑、跌破 20 日低點就走，靠少數大波段賺錢（海龜交易法）。',
      entryRules: '收盤價突破前 55 日最高價，隔日開盤買進',
      exitRules: '收盤價跌破前 20 日最低價，或觸及 2 倍 ATR 停損',
      riskPerTradePercent: 1,
      notes: '勝率通常只有 30–40%，要能忍受連續小賠。',
    },
    suits: '想學趨勢追蹤、能接受低勝率',
    risk: '假突破多時會連續停損',
  },
  {
    id: 'bluechip-rsi',
    card: {
      name: '權值股 RSI 回檔',
      template: 'rsi_reversion',
      params: { rsiDays: 2, trendDays: 200, entryBelow: 10, exitAbove: 70, maxHoldDays: 10, atrStop: 3 },
      symbols: ['TW:2330', 'TW:2317', 'TW:2454'],
      edge: '長期多頭中的優質權值股，短線恐慌超賣後傾向反彈（康納斯短線回檔）。',
      entryRules: '股價在 200 日均線之上，且 RSI(2) 低於 10，隔日開盤買進',
      exitRules: 'RSI(2) 回到 70 以上、持有滿 10 天，或觸及 3 倍 ATR 停損',
      riskPerTradePercent: 1,
      notes: '每檔分配等額資金；交易次數比趨勢策略多，成本影響較大。持倉時間約 1～2 成，報酬不要和全額持有直接比，看夏普比率與回撤。',
    },
    suits: '偏好高勝率、短持有期的人',
    risk: '多頭結束時第一次回檔可能就是崩跌的開始，停損一定要設',
  },
  {
    id: 'tsmc-trend',
    card: {
      name: '半導體龍頭趨勢',
      template: 'ma_cross',
      params: { fast: 50, slow: 200, atrStop: 3 },
      symbols: ['TW:2330'],
      edge: '產業龍頭的長期趨勢明確；50／200 日均線交叉（黃金／死亡交叉）只在大方向改變時進出，交易次數少。',
      entryRules: '50 日均線向上穿越 200 日均線，隔日開盤買進',
      exitRules: '50 日均線跌破 200 日均線，或觸及 3 倍 ATR 停損',
      riskPerTradePercent: 1,
      notes: '單一個股集中度高，部位要受單檔上限約束。',
    },
    suits: '看好單一龍頭、想用規則管理進出',
    risk: '交易次數很少，回測樣本不足時結論不可靠',
  },
  {
    id: 'screener-momentum',
    card: {
      name: '篩選器動能前段班',
      template: 'discretionary',
      params: {},
      symbols: [],
      edge: '個股的 12 個月動能效應在台股與美股都有研究支持；每月更新名單，持有最強的幾檔。',
      entryRules: '每月第一週，用「模擬交易 → 選股」的「動能」篩選，買進前 5 名（每檔等額，排除流動性不足）',
      exitRules: '每月檢查：跌出前 20 名就賣出；觸及 2.5 倍 ATR 停損立即出場',
      riskPerTradePercent: 1,
      notes: '無法自動回測：先在虛擬帳戶照規則操作，每月記錄名單變化。',
    },
    suits: '想從個股開始、但不想主觀挑股票',
    risk: '動能反轉時多檔同時下跌；同產業集中要注意',
  },
  {
    id: 'value-growth',
    card: {
      name: '價值＋成長選股',
      template: 'discretionary',
      params: {},
      symbols: [],
      edge: '便宜（低本益比、低淨值比）且營收正在成長的公司，較少是「價值陷阱」；市場重新評價時有雙重報酬。',
      entryRules: '同時出現在「價值」與「成長」篩選結果（或價值篩選中營收年增 > 10%）的公司，寫完研究卡、現價低於買進價後分 3 批建倉',
      exitRules: '研究卡的失效條件觸發、估值超過樂觀合理價，或觸及停損',
      riskPerTradePercent: 1,
      notes: '結合手冊 06、07 的研究卡流程；適合願意讀財報的人。',
    },
    suits: '願意做基本面研究、持有期較長',
    risk: '研究需要時間；便宜可能有原因',
  },
  {
    id: 'dca-benchmark',
    card: {
      name: '0050 定期定額（基準）',
      template: 'dca',
      params: { monthlyAmount: 10000 },
      symbols: ['TW:0050'],
      edge: '不需要優勢：取得市場報酬。所有交易策略都應該和它比較。',
      entryRules: '每月第一個交易日投入固定金額',
      exitRules: '不出場',
      riskPerTradePercent: 1,
      notes: '這是核心部位的做法，放在這裡作為比較基準。',
    },
    suits: '每個人（作為比較基準）',
    risk: '短期仍會跟著大盤下跌',
  },
]
