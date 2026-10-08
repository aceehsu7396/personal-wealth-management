import { z } from 'zod'
import type { MacroCheckIn, Market } from '../storage/schema'
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

export function buildMarketPrompt(today: string): string {
  return `今天是 ${today}。請上網搜尋最新資料，撰寫台股與美股的「總經三支柱」研究報告，供長期投資人每月檢視使用。

## 報告結構
1. 摘要（3–5 點）
2. 支柱一：景氣體制——成長與通膨的方向（相較 3–6 個月前）
   - 美國：ISM 製造業 PMI、非農就業與失業率趨勢、CPI／核心 PCE
   - 台灣：國發會景氣對策信號、外銷訂單年增率、CPI
3. 支柱二：流動性——Fed 與台灣央行利率方向、美國 10 年減 2 年公債利差、高收益債信用利差、Fed 資產負債表、美元指數
4. 支柱三：情緒溫度——台股與 S&P 500 本益比相對歷史的位置、信用條件、新股上市與題材熱度、媒體氛圍、台股融資餘額變化、VIX
5. 政策與地緣政治重點
6. 估值概況：台股與美股大盤目前的評價水準

每個指標寫出最新數值、資料日期、與 3–6 個月前相比的方向。`
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

export function buildStockPrompt(ticker: string, name: string, market: Market, today: string): string {
  const label = `${MARKET_NAMES[market]}股票 ${ticker}${name ? ` ${name}` : ''}`
  return `今天是 ${today}。請上網搜尋最新資料，撰寫「${label}」的個股研究報告，作為長期投資人填寫研究卡的素材。

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

export async function analyzeStock(
  ticker: string,
  name: string,
  market: Market,
  today: string,
  clients?: { research?: ResearchClient; extraction?: ExtractionClient },
): Promise<AnalysisOutcome<StockFacts>> {
  const research = await runWebResearch(
    { prompt: buildStockPrompt(ticker, name, market, today) },
    clients?.research,
  )
  const extraction = await extractStructured(
    StockFactsSchema,
    STOCK_EXTRACTION_INSTRUCTIONS,
    research.markdown,
    clients?.extraction,
  )
  return {
    research,
    facts: extraction.data,
    estimatedCostUsd: research.estimatedCostUsd + extraction.estimatedCostUsd,
  }
}
