// The system map (handbook chapter 00 §2, appendix C): every part of the
// process, what it hands to the next, and why it comes in that order. The
// handbook diagram and the "在架構中的位置" bar on each page both read it.

export interface ArchNode {
  id: string
  title: string
  what: string
  why: string
  page: { to: string; label: string }
  handbook: { slug: string; label: string }
  // Action-roadmap steps this part completes.
  steps: string[]
}

export type EdgeKind = 'flow' | 'gate' | 'feedback'

export interface ArchEdge {
  from: string
  to: string
  label: string
  kind: EdgeKind
}

export interface ArchLayer {
  title: string
  summary: string
  nodes: string[]
}

export const ARCH_NODES: Record<string, ArchNode> = {
  foundation: {
    id: 'foundation',
    title: '財務地基',
    what: '算出全職門檻、生活費緩衝與緊急預備金，反推需要多少年化報酬。',
    why: '生活費先與市場隔開，才不會在低點被迫賣出；所需報酬決定了要承擔多少風險。',
    page: { to: '/goals', label: '目標與政策' },
    handbook: { slug: '01', label: '01 財務地基' },
    steps: ['1.1', '1.2', '1.3'],
  },
  ips: {
    id: 'ips',
    title: '投資政策聲明',
    what: '把配置比例、部位上限、每筆風險、回撤熔斷寫成規則並簽署。',
    why: '所有下游的檢核都讀這裡的數字；先定規則，情緒來的時候才有依據說「不」。',
    page: { to: '/goals', label: '目標與政策' },
    handbook: { slug: '02', label: '02 投資政策聲明' },
    steps: ['1.4'],
  },
  macro: {
    id: 'macro',
    title: '總經三支柱',
    what: '每月依成長、通膨、流動性、情緒判斷景氣體制與順逆風。',
    why: '總經只調「多少」（股債比例、交易部位能否新建倉），不決定「買什麼」。',
    page: { to: '/research/market', label: '研究分析・市場' },
    handbook: { slug: '05', label: '05 總體經濟與政策' },
    steps: ['3.1', '3.2'],
  },
  core: {
    id: 'core',
    title: '核心 ETF 定期定額',
    what: '依投資政策的核心比例，每月固定買進指數 ETF，不擇時。',
    why: '先拿到市場報酬（貝他）並養成紀律；它也是交易部位必須打敗的基準。',
    page: { to: '/portfolio', label: '投資組合・持股與風控' },
    handbook: { slug: '03', label: '03 核心配置與定期定額' },
    steps: ['2.1', '2.2', '2.3'],
  },
  strategy: {
    id: 'strategy',
    title: '策略卡',
    what: '寫下交易策略：範本與參數、標的、優勢、進出場規則、每筆風險。',
    why: '沒有寫下來的規則無法回測、也無法檢討；策略卡是交易部位每一筆實單的依據。',
    page: { to: '/sim/strategies', label: '模擬交易・策略卡' },
    handbook: { slug: '10', label: '10 交易策略開發與回測' },
    steps: ['4.1'],
  },
  backtest: {
    id: 'backtest',
    title: '回測',
    what: '用歷史資料檢驗策略卡，保留樣本外驗證，並看參數敏感度。',
    why: '先證明策略有優勢：樣本外要在報酬，或在風險調整後（夏普比率較好、回撤明顯較小）勝過買進持有，否則直接用核心 ETF 就好。',
    page: { to: '/sim/backtest', label: '模擬交易・回測' },
    handbook: { slug: '10', label: '10 §6 回測' },
    steps: ['4.2'],
  },
  paper: {
    id: 'paper',
    title: '虛擬帳戶',
    what: '用即時價格照策略卡下虛擬單，記錄成交、停損與情緒。',
    why: '回測證明策略有優勢，虛擬交易證明「你」能照規則執行；兩關都過才用真錢。',
    page: { to: '/sim/paper', label: '模擬交易・虛擬帳戶' },
    handbook: { slug: '10', label: '10 §7 虛擬交易' },
    steps: ['4.3'],
  },
  screener: {
    id: 'screener',
    title: '選股與觀察名單',
    what: '用免費資料篩出候選標的，加入觀察名單。',
    why: '先縮小範圍，再花時間研究；觀察名單同時供策略卡與研究卡使用。',
    page: { to: '/sim/screener', label: '模擬交易・選股' },
    handbook: { slug: '附錄B', label: '附錄 B 名詞解釋' },
    steps: [],
  },
  industry: {
    id: 'industry',
    title: '產業與商業模式',
    what: '能力圈、五力、競爭優勢：判斷公司能不能長期賺錢。',
    why: '財報只告訴你過去；產業結構決定好成績能不能延續。',
    page: { to: '/research/industry', label: '研究分析・產業' },
    handbook: { slug: '06', label: '06 產業與商業模式' },
    steps: [],
  },
  research: {
    id: 'research',
    title: '研究卡與進出場建議',
    what: '自動體檢財報與估值、給出觀察評等；你選結論後，算出三批買進價、減碼出清價與建議股數。',
    why: '把「好公司」與「好價格」分開判斷；價位與股數由規則算出，避免追高或憑感覺加碼。',
    page: { to: '/research/stocks', label: '研究分析・個股' },
    handbook: { slug: '07', label: '07 財務與價值評估' },
    steps: [],
  },
  checklist: {
    id: 'checklist',
    title: '交易前檢核與交易日誌',
    what: '每筆下單前逐項檢核（政策上限、總經、策略卡或研究卡、停損與風險），成交後記錄並事後檢討。',
    why: '檢核表擋下已知錯誤；日誌把決策品質和結果分開，才能檢討。',
    page: { to: '/portfolio/trades', label: '投資組合・交易日誌' },
    handbook: { slug: '04', label: '04 紀律與檢核流程' },
    steps: ['5.1', '5.3'],
  },
  risk: {
    id: 'risk',
    title: '持股與組合風控',
    what: '檢查配置偏離、部位與產業集中度、美元曝險、回撤熔斷。',
    why: '個別看法再強，部位大小也由規則決定；先求不大輸。',
    page: { to: '/portfolio', label: '投資組合・持股與風控' },
    handbook: { slug: '08', label: '08 投資組合策略與風險' },
    steps: [],
  },
  review: {
    id: 'review',
    title: '績效歸因',
    what: '每季拆解報酬：配置效果、選股或策略效果，與基準比較。',
    why: '區分能力與運氣；連續落後基準就依規則縮小交易部位，並回頭修訂投資政策。',
    page: { to: '/portfolio/review', label: '投資組合・績效歸因' },
    handbook: { slug: '08', label: '08 §6 績效歸因' },
    steps: ['5.2'],
  },
  fulltime: {
    id: 'fulltime',
    title: '全職準備度',
    what: '資產門檻、生活費緩衝、實單績效、回撤控制、執行紀律五項全過。',
    why: '全職是終點，不是起點；每一關都用數據證明過才離開本業。',
    page: { to: '/goals', label: '目標與政策・全職準備度' },
    handbook: { slug: '11', label: '11 財務獨立與全職經營' },
    steps: [],
  },
}

export const ARCH_LAYERS: ArchLayer[] = [
  { title: '第 0 層 政策', summary: '定框架：目標、風險、上限', nodes: ['foundation', 'ips'] },
  { title: '構面一 總經', summary: '只調比例與新建倉', nodes: ['macro'] },
  { title: '核心與策略驗證', summary: '核心拿市場報酬；策略逐關證明', nodes: ['core', 'strategy', 'backtest', 'paper'] },
  { title: '構面二、三 選股研究', summary: '個股策略的工具：品質＋價格', nodes: ['screener', 'industry', 'research'] },
  { title: '執行與紀律', summary: '每筆都檢核、都記錄', nodes: ['checklist'] },
  { title: '構面四 組合風控', summary: '大小與集中度由規則決定', nodes: ['risk'] },
  { title: '檢討與終點', summary: '歸因回饋政策；全過才全職', nodes: ['review', 'fulltime'] },
]

export const ARCH_EDGES: ArchEdge[] = [
  { from: 'foundation', to: 'ips', label: '所需報酬、生活費緩衝月數', kind: 'flow' },
  { from: 'ips', to: 'core', label: '核心台股／全球／債券比例', kind: 'flow' },
  { from: 'ips', to: 'strategy', label: '交易部位上限、每筆風險上限、必設停損', kind: 'flow' },
  { from: 'ips', to: 'research', label: '安全邊際、單一部位上限', kind: 'flow' },
  { from: 'ips', to: 'risk', label: '部位／產業／美元上限、回撤熔斷', kind: 'flow' },
  { from: 'macro', to: 'core', label: '股債比例傾斜（有上限）', kind: 'flow' },
  { from: 'macro', to: 'research', label: '本月順逆風訊號', kind: 'flow' },
  { from: 'macro', to: 'checklist', label: '逆風時交易部位暫停新建倉', kind: 'gate' },
  { from: 'strategy', to: 'backtest', label: '範本、參數、標的', kind: 'flow' },
  { from: 'backtest', to: 'paper', label: '樣本外勝過買進持有（報酬或風險調整後）才進虛擬交易', kind: 'gate' },
  { from: 'paper', to: 'checklist', label: '虛擬交易 3 個月、10 筆才解鎖實單', kind: 'gate' },
  { from: 'screener', to: 'strategy', label: '候選標的', kind: 'flow' },
  { from: 'screener', to: 'research', label: '候選個股與 ETF', kind: 'flow' },
  { from: 'industry', to: 'research', label: '能力圈與競爭優勢', kind: 'flow' },
  { from: 'research', to: 'checklist', label: '結論、買進價、建議股數與停損', kind: 'flow' },
  { from: 'core', to: 'checklist', label: '每月定期定額', kind: 'flow' },
  { from: 'checklist', to: 'risk', label: '成交後成為持股', kind: 'flow' },
  { from: 'risk', to: 'research', label: '持股對照：減碼、出清、複查提醒', kind: 'feedback' },
  { from: 'risk', to: 'review', label: '持股、交易與權益紀錄', kind: 'flow' },
  { from: 'review', to: 'ips', label: '每年依歸因修訂政策與交易部位上限', kind: 'feedback' },
  { from: 'review', to: 'fulltime', label: '實單績效與紀律分數', kind: 'flow' },
]

// The main part each page belongs to (for the page context bar).
export const PAGE_NODES: Record<string, string> = {
  '/goals': 'ips',
  '/research/market': 'macro',
  '/research/industry': 'industry',
  '/research/stocks': 'research',
  '/sim/screener': 'screener',
  '/sim/strategies': 'strategy',
  '/sim/backtest': 'backtest',
  '/sim/paper': 'paper',
  '/portfolio': 'risk',
  '/portfolio/trades': 'checklist',
  '/portfolio/review': 'review',
}

export type NodeStatus = 'done' | 'current' | 'todo' | 'ongoing'

// Done when every step is done; current when it holds the next step;
// parts without roadmap steps are used throughout ("ongoing").
export function nodeStatus(node: ArchNode, doneSteps: Set<string>, nextStep: string | null): NodeStatus {
  if (node.steps.length === 0) return 'ongoing'
  if (nextStep && node.steps.includes(nextStep)) return 'current'
  return node.steps.every((s) => doneSteps.has(s)) ? 'done' : 'todo'
}

export function edgesInto(id: string): ArchEdge[] {
  return ARCH_EDGES.filter((e) => e.to === id)
}

export function edgesOutOf(id: string): ArchEdge[] {
  return ARCH_EDGES.filter((e) => e.from === id)
}
