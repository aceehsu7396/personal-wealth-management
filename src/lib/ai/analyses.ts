import { z } from 'zod'
import type { MacroCheckIn, Market, ResearchSource } from '../storage/schema'
import { runWebResearch, type ResearchClient, type ResearchResult } from './webResearch'
import { extractStructured, type ExtractionClient } from './extractStructured'

// ---------------------------------------------------------------------------
// Market analysis → macro check-in draft
// ---------------------------------------------------------------------------

const trend = z.object({
  value: z.enum(['up', 'flat', 'down']).describe('相較 3–6 個月前：up 改善/上升、flat 持平或資料不足、down 惡化/下降'),
  reason: z.string().describe('一句話理由，含數字與資料日期；資料不足寫「未取得」'),
})
const signal = (meaning: string) =>
  z.object({
    value: z.enum(['1', '0', '-1']).describe(meaning),
    reason: z.string().describe('一句話理由，含數字與資料日期；資料不足寫「未取得」並填 0'),
  })
const liquidity = signal('1 寬鬆、0 中性或資料不足、-1 緊縮')
const sentiment = signal('1 過熱、0 正常或資料不足、-1 恐慌')

export const MacroDraftSchema = z.object({
  growth: z.object({ usPmi: trend, usEmployment: trend, twBusinessSignal: trend, twExportOrders: trend }),
  inflation: z.object({ usCpi: trend, twCpi: trend }),
  liquidity: z.object({
    policyRate: liquidity,
    yieldCurve: liquidity,
    creditSpread: liquidity,
    centralBankBalanceSheet: liquidity,
    usDollar: liquidity,
  }),
  sentiment: z.object({
    valuation: sentiment,
    credit: sentiment,
    ipoHype: sentiment,
    media: sentiment,
    margin: sentiment,
    vix: sentiment,
  }),
  policyNote: z.string().describe('貨幣、財政、產業政策與地緣政治重點，2–4 句'),
})
export type MacroDraft = z.infer<typeof MacroDraftSchema>

// Primary macro source: Fubon Financial's research report list. The model
// fetches the list, then the latest monthly outlook PDF linked from it.
export const MACRO_PRIMARY_SOURCE = 'https://invest.fubonlife.com.tw/w/wa/waFubonlifeMSG.djhtm'

export function buildMarketPrompt(today: string): string {
  return `今天是 ${today}。請撰寫台股與美股的「總經三支柱」研究報告，供長期投資人每月檢視使用。

## 資料來源（請照順序）
1. **主要來源**：先用網頁讀取工具開啟富邦金控研究報告列表 ${MACRO_PRIMARY_SOURCE} ，找出日期最新的一期「富邦總經觀點-○月市場展望」，再開啟它連結的 PDF 全文。若最近 1 個月內另有「富邦總經分析」與台灣、美國或金融市場風險相關，也一併讀取。
2. 以這份報告為主要依據撰寫各支柱，並在報告開頭註明所依據的報告名稱與日期。
3. **只在報告沒有涵蓋，或報告日期之後有更新的數據時**，才上網搜尋補充（例如最新的 PMI、CPI、VIX、信用利差），並註明哪些數據來自富邦報告、哪些來自其他來源。
4. 若列表或 PDF 無法開啟，改以上網搜尋取得資料，並在報告開頭說明。

## 報告結構
1. 依據來源：富邦報告名稱與日期，以及補充來源
2. 摘要（3–5 點），包含富邦報告的主要觀點
3. 支柱一：景氣體制——成長與通膨的方向（相較 3–6 個月前）
   - 美國：ISM 製造業 PMI、非農就業與失業率趨勢、CPI／核心 PCE
   - 台灣：國發會景氣對策信號、外銷訂單年增率、CPI
4. 支柱二：流動性——Fed 與台灣央行利率方向、美國 10 年減 2 年公債利差、高收益債信用利差、Fed 資產負債表、美元指數
5. 支柱三：情緒溫度——台股與 S&P 500 本益比相對歷史的位置、信用條件、新股上市與題材熱度、媒體氛圍、台股融資餘額變化、VIX
6. 政策與地緣政治重點
7. 估值概況：台股與美股大盤目前的評價水準

每個指標寫出最新數值、資料日期、與 3–6 個月前相比的方向。富邦報告中的投資建議或配置看法可以摘要呈現，但要標明是富邦的觀點。`
}

export const MACRO_EXTRACTION_INSTRUCTIONS =
  '把研究報告中的總經資料，轉成總經三支柱的 17 個訊號判斷。方向以「相較 3–6 個月前」為準；流動性 1 代表寬鬆；情緒 1 代表過熱、-1 代表恐慌（例如本益比在歷史高檔為 1、VIX 高於 30 為 -1、低於 13 為 1）。'

export type MacroDraftValues = Omit<MacroCheckIn, 'id' | 'createdAt'>

// Converts the AI draft into form values plus a reason per field path
// (e.g. "liquidity.policyRate") for display next to each select.
export function macroDraftToForm(
  draft: MacroDraft,
  date: string,
): { values: MacroDraftValues; reasons: Record<string, string> } {
  const reasons: Record<string, string> = {}
  const trends = <K extends string>(group: string, obj: Record<K, z.infer<typeof trend>>) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const t = v as z.infer<typeof trend>
        reasons[`${group}.${k}`] = t.reason
        return [k, t.value]
      }),
    ) as Record<K, 'up' | 'flat' | 'down'>
  const signals = <K extends string>(group: string, obj: Record<K, { value: '1' | '0' | '-1'; reason: string }>) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const s = v as { value: '1' | '0' | '-1'; reason: string }
        reasons[`${group}.${k}`] = s.reason
        return [k, Number(s.value)]
      }),
    ) as Record<K, number>

  return {
    values: {
      date,
      growth: trends('growth', draft.growth),
      inflation: trends('inflation', draft.inflation),
      liquidity: signals('liquidity', draft.liquidity),
      sentiment: signals('sentiment', draft.sentiment),
      policyNote: draft.policyNote,
      note: 'AI 預填草稿，已人工確認',
    },
    reasons,
  }
}

// ---------------------------------------------------------------------------
// Industry analysis (report only)
// ---------------------------------------------------------------------------

export const MARKET_NAMES: Record<Market, string> = { TW: '台灣', US: '美國' }

export function buildIndustryPrompt(industry: string, market: Market, today: string): string {
  return `今天是 ${today}。請上網搜尋最新資料，撰寫「${MARKET_NAMES[market]}市場：${industry}產業」的產業研究報告，供長期投資人判斷這個產業是否值得深入研究。

## 報告結構
1. 摘要（3–5 點）
2. 產業生命週期：萌芽／成長／成熟／衰退，並說明依據（市場規模、成長率）
3. 波特五力觀察：現有競爭、新進者、替代品、客戶議價力、供應商議價力，各給出具體事實
4. 供應鏈與價值鏈：主要環節、誰有定價能力、台灣/美國公司的位置
5. 成長驅動與趨勢：可量化的需求來源
6. 政策、景氣循環與地緣風險
7. 代表公司：列出 5–8 家（代號、名稱、所在環節、一句話特色），只做描述不做推薦
8. 值得追蹤的指標`
}

// ---------------------------------------------------------------------------
// Stock analysis → research card fact draft
// ---------------------------------------------------------------------------

export const StockFactsSchema = z.object({
  name: z.string().describe('公司名稱；未取得填空字串'),
  sector: z.string().describe('所屬產業，簡短；未取得填空字串'),
  currency: z.enum(['TWD', 'USD']),
  currentPrice: z.number().nullable().describe('最近收盤價；未取得填 null'),
  priceDate: z.string().describe('股價日期 YYYY-MM-DD；未取得填空字串'),
  roicPercent: z.number().nullable().describe('投入資本報酬率近 5 年平均（%）；未取得填 null'),
  historicalGrowthPercent: z.number().nullable().describe('過去 5 年營收或 EPS 年複合成長率（%）；未取得填 null'),
  growthBasis: z.string().describe('成長率依據（例如「營收 2020–2025 CAGR」）；未取得填空字串'),
  fScore: z.number().nullable().describe('Piotroski F 分數 0–9，只在 9 項都能判斷時填；否則 null'),
  fScoreItems: z
    .array(z.object({ item: z.string(), passed: z.boolean().nullable(), note: z.string() }))
    .describe('F 分數 9 項逐項判斷；無法判斷的 passed 填 null'),
  redFlags: z.string().describe('財報紅旗（應收/存貨異常成長、現金流低於淨利、會計師變更等）；沒有發現寫「未發現」'),
})
export type StockFacts = z.infer<typeof StockFactsSchema>

// Price and valuation already known from TWSE, so the model does not spend
// searches on them.
export interface KnownQuote {
  price: number | null
  pe: number | null
  pb: number | null
  dividendYield: number | null
  date: string
}

function knownQuoteLine(known: KnownQuote | undefined): string {
  if (!known) return ''
  const parts = [
    known.price !== null ? `收盤價 ${known.price}` : null,
    known.pe !== null ? `本益比 ${known.pe}` : null,
    known.pb !== null ? `股價淨值比 ${known.pb}` : null,
    known.dividendYield !== null ? `殖利率 ${known.dividendYield}%` : null,
  ].filter(Boolean)
  if (parts.length === 0) return ''
  return `\n以下數據已由台灣證券交易所取得（${known.date}），直接使用、不需要再搜尋：${parts.join('、')}。\n`
}

// Search budget is limited, so numbers come first: one page with several
// years of financials beats one search per figure.
const NUMBERS_FIRST = `## 搜尋順序（搜尋次數有限，請照順序）
1. **先取得財務數字**：近 5 年營收、EPS、投入資本報酬率，以及 F 分數需要的資料（資產報酬率、營業現金流、長期負債、流動比率、流通股數、毛利率、資產週轉率）。優先讀取一個頁面就能看到多年數據的來源（公司年報或法說會簡報、公開資訊觀測站、財報彙整網站），不要每個數字分別搜尋。
2. 數字取得後，再查商業模式、競爭優勢、近期新聞與風險。
3. 搜尋次數用完時，用已取得的資料完成報告，缺少的數字寫「未取得」。`

export function buildStockPrompt(
  ticker: string,
  name: string,
  market: Market,
  today: string,
  known?: KnownQuote,
): string {
  const label = `${MARKET_NAMES[market]}股票 ${ticker}${name ? ` ${name}` : ''}`
  return `今天是 ${today}。請上網搜尋最新資料，撰寫「${label}」的個股研究報告，作為長期投資人填寫研究卡的素材。
${knownQuoteLine(known)}
${NUMBERS_FIRST}

## 報告結構
1. 摘要（3–5 點）
2. 商業模式：怎麼賺錢、營收組成、主要客戶與集中度
3. 競爭優勢：規模經濟、網路效應、轉換成本、品牌、壟斷資源、流程力等，各舉事實；護城河在擴大還是縮小
4. 近期財報重點：最近 4 季營收、毛利率、營業利益率、EPS、自由現金流；與一年前比較
5. 財務品質：近 5 年投入資本報酬率、負債比、利息保障倍數；Piotroski F 分數 9 項逐項判斷（有資料才判斷）
6. 估值概況：目前股價與日期、本益比、股價淨值比、殖利率，以及相對近 5 年的位置
7. 主要風險與財報紅旗
8. 反方觀點：最強的看空理由是什麼？
9. 值得追蹤的失效訊號（可作為研究卡「失效條件」的參考）`
}

// Key figures the research card pre-fills; a run missing too many of them
// gets one focused follow-up search.
export const STOCK_KEY_FIELDS = {
  currentPrice: '現價',
  roicPercent: '投入資本報酬率（近 5 年平均）',
  historicalGrowthPercent: '過去 5 年營收或 EPS 年複合成長率',
  fScore: 'Piotroski F 分數（9 項逐項）',
} as const
export type StockKeyField = keyof typeof STOCK_KEY_FIELDS

export const FOLLOW_UP_MIN_MISSING = 2
export const FOLLOW_UP_MAX_SEARCHES = 6

export function missingStockFields(facts: StockFacts): StockKeyField[] {
  return (Object.keys(STOCK_KEY_FIELDS) as StockKeyField[]).filter((k) => facts[k] === null)
}

// Fills gaps in `primary` from `extra`, keeping each value with its context
// (price with its date, growth with its basis, F score with its items).
export function mergeStockFacts(primary: StockFacts, extra: StockFacts): StockFacts {
  const merged = { ...primary }
  if (merged.currentPrice === null && extra.currentPrice !== null) {
    merged.currentPrice = extra.currentPrice
    merged.priceDate = extra.priceDate
    merged.currency = extra.currency
  }
  if (merged.roicPercent === null) merged.roicPercent = extra.roicPercent
  if (merged.historicalGrowthPercent === null && extra.historicalGrowthPercent !== null) {
    merged.historicalGrowthPercent = extra.historicalGrowthPercent
    merged.growthBasis = extra.growthBasis
  }
  if (merged.fScore === null && extra.fScore !== null) {
    merged.fScore = extra.fScore
    merged.fScoreItems = extra.fScoreItems
  }
  if (!merged.name) merged.name = extra.name
  if (!merged.sector) merged.sector = extra.sector
  return merged
}

// TWSE already has today's close; use it when the report did not find one.
export function applyKnownQuote(facts: StockFacts, known: KnownQuote | undefined): StockFacts {
  if (!known || known.price === null || facts.currentPrice !== null) return facts
  return { ...facts, currentPrice: known.price, priceDate: known.date, currency: 'TWD' }
}

export function buildStockFollowUpPrompt(
  ticker: string,
  name: string,
  market: Market,
  today: string,
  missing: StockKeyField[],
): string {
  const label = `${MARKET_NAMES[market]}股票 ${ticker}${name ? ` ${name}` : ''}`
  const items = missing.map((k) => `- ${STOCK_KEY_FIELDS[k]}`).join('\n')
  return `今天是 ${today}。上一輪研究「${label}」時，下列財務數據沒有查到。請**只查這些數字**，不需要撰寫商業模式或新聞：

${items}

優先讀取一個頁面就能看到多年財務數據的來源（公司年報、公開資訊觀測站、財報彙整網站）。每個數字註明期間、資料日期與來源；F 分數請逐項列出 9 項的判斷依據。真的找不到的寫「未取得」，不要估算。

用「## 補查：財務數據」作為標題，以條列或表格呈現。`
}

export const STOCK_EXTRACTION_INSTRUCTIONS =
  '從研究報告中擷取這家公司可查證的事實數據。不要自行估算合理價、評分或投資建議；報告沒有明確數字的欄位填 null 或空字串。'

// Only factual, checkable fields are pre-filled; judgment fields (five
// forces, powers, thesis, fair values) are left to the user.
export function stockFactsToDraft(facts: StockFacts) {
  return {
    name: facts.name || undefined,
    sector: facts.sector || undefined,
    currentPrice: facts.currentPrice ?? undefined,
    roicPercent: facts.roicPercent ?? undefined,
    historicalGrowthPercent: facts.historicalGrowthPercent ?? undefined,
    fScore:
      facts.fScore !== null && facts.fScore >= 0 && facts.fScore <= 9 ? Math.round(facts.fScore) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface AnalysisOutcome<Facts> {
  research: ResearchResult
  facts: Facts | null
  estimatedCostUsd: number
  // Stock analysis only: whether a follow-up search ran, and what is still
  // missing after it.
  followUp?: boolean
  stillMissing?: StockKeyField[]
}

export async function analyzeMarket(
  today: string,
  clients?: { research?: ResearchClient; extraction?: ExtractionClient },
): Promise<AnalysisOutcome<MacroDraft>> {
  const research = await runWebResearch({ prompt: buildMarketPrompt(today) }, clients?.research)
  const extraction = await extractStructured(
    MacroDraftSchema,
    MACRO_EXTRACTION_INSTRUCTIONS,
    research.markdown,
    clients?.extraction,
  )
  return {
    research,
    facts: extraction.data,
    estimatedCostUsd: research.estimatedCostUsd + extraction.estimatedCostUsd,
  }
}

export async function analyzeIndustry(
  industry: string,
  market: Market,
  today: string,
  clients?: { research?: ResearchClient },
): Promise<AnalysisOutcome<null>> {
  const research = await runWebResearch({ prompt: buildIndustryPrompt(industry, market, today) }, clients?.research)
  return { research, facts: null, estimatedCostUsd: research.estimatedCostUsd }
}

function mergeSources(a: ResearchSource[], b: ResearchSource[]): ResearchSource[] {
  const seen = new Map(a.map((s) => [s.url, s]))
  for (const s of b) if (!seen.has(s.url)) seen.set(s.url, s)
  return [...seen.values()]
}

export async function analyzeStock(
  ticker: string,
  name: string,
  market: Market,
  today: string,
  clients?: { research?: ResearchClient; extraction?: ExtractionClient },
  known?: KnownQuote,
): Promise<AnalysisOutcome<StockFacts>> {
  const research = await runWebResearch(
    { prompt: buildStockPrompt(ticker, name, market, today, known) },
    clients?.research,
  )
  const extraction = await extractStructured(
    StockFactsSchema,
    STOCK_EXTRACTION_INSTRUCTIONS,
    research.markdown,
    clients?.extraction,
  )
  let facts = applyKnownQuote(extraction.data, known)
  let cost = research.estimatedCostUsd + extraction.estimatedCostUsd
  let markdown = research.markdown
  let sources = research.sources
  let searchCount = research.searchCount

  // One focused follow-up when too many key figures are missing.
  const missing = missingStockFields(facts)
  const followUp = missing.length >= FOLLOW_UP_MIN_MISSING
  if (followUp) {
    const extra = await runWebResearch(
      {
        prompt: buildStockFollowUpPrompt(ticker, name, market, today, missing),
        maxSearches: FOLLOW_UP_MAX_SEARCHES,
      },
      clients?.research,
    )
    const extraFacts = await extractStructured(
      StockFactsSchema,
      STOCK_EXTRACTION_INSTRUCTIONS,
      extra.markdown,
      clients?.extraction,
    )
    facts = mergeStockFacts(facts, extraFacts.data)
    markdown = `${markdown}\n\n${extra.markdown}`
    sources = mergeSources(sources, extra.sources)
    searchCount += extra.searchCount
    cost += extra.estimatedCostUsd + extraFacts.estimatedCostUsd
  }

  const stillMissing = missingStockFields(facts)
  if (stillMissing.length > 0) {
    const list = stillMissing.map((k) => STOCK_KEY_FIELDS[k]).join('、')
    markdown = `> **以下數據${followUp ? '補查後仍' : '本次'}未取得**：${list}。可依公司年報自行補在研究卡上，或稍後再分析一次。\n\n${markdown}`
  }

  return {
    research: { ...research, markdown, sources, searchCount, estimatedCostUsd: cost },
    facts,
    estimatedCostUsd: cost,
    followUp,
    stillMissing,
  }
}
