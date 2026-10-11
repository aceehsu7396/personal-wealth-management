import { FubonOutlookContentSchema, type FubonOutlook } from '../storage/schema'
import { MACRO_SIGNAL_LABELS, TRACKED_INDEX_LABELS } from '../calculations/fubonTracking'
import { runWebResearch, type ResearchClient } from './webResearch'
import { extractStructured, type ExtractionClient } from './extractStructured'
import { fubonUsage, MACRO_PRIMARY_SOURCE } from './analyses'

const SIGNAL_LIST = Object.entries(MACRO_SIGNAL_LABELS)
  .map(([key, label]) => `- ${label}（${key}）`)
  .join('\n')
const INDEX_LIST = Object.entries(TRACKED_INDEX_LABELS)
  .map(([key, { label }]) => `- ${label}（${key}）`)
  .join('\n')

export function buildFubonDigestPrompt(today: string): string {
  return `今天是 ${today}。請用網頁讀取工具開啟富邦金控研究報告列表 ${MACRO_PRIMARY_SOURCE} ，找出日期最新的一期「富邦總經觀點-○月市場展望」，再開啟它連結的 PDF 全文，**只根據這份 PDF** 整理下列內容（不需要上網搜尋其他資料）。每一點都要附頁碼（p.X）。

## 1. 報告資訊
報告名稱、發布日期（YYYY-MM-DD）、PDF 網址。

## 2. 摘要
3–5 句，說明富邦對這個月的整體看法。

## 3. 各段重點
依報告的章節（總經觀點、外匯市場、債券市場、成熟市場、新興市場）條列 3–5 點重點。

## 4. 月度配置觀點
表格：資產類別｜看法（▲正向、●中性、▼負向）｜理由。

## 5. 下月預測區間
表格：項目｜下限｜上限。只列報告中有明確區間的項目，項目名稱請用下列清單（括號內為代碼）：
${INDEX_LIST}

## 6. 上月實際收盤
表格：項目｜數值。只列報告中明確寫出的上月底收盤或月底數值（例如「全月上漲 2.62% 至 7,686.2」），項目同上。

## 7. 對總經三支柱 17 個訊號的涵蓋度
表格：訊號｜涵蓋（有明確數據與方向）／部分（只有質化描述或相關指標）／未涵蓋｜說明｜頁碼。17 個訊號（括號內為代碼）：
${SIGNAL_LIST}

如果列表或 PDF 無法開啟，請直接說明，不要用其他來源代替。`
}

export const FUBON_DIGEST_EXTRACTION_INSTRUCTIONS =
  '把這份富邦報告整理轉成結構化資料。reportDate 用 YYYY-MM-DD；sections 依報告章節，每點附頁碼（例如「p.3」，未知填空字串）；allocation 的 view 用 positive（▲）、neutral（●）、negative（▼）；forecasts 與 actuals 的 index、coverage 的 signal 必須使用整理中括號內的代碼；coverage 要列出全部 17 個訊號。整理說明無法開啟報告時，reportTitle 填空字串。'

export async function digestFubonOutlook(
  today: string,
  clients?: { research?: ResearchClient; extraction?: ExtractionClient },
): Promise<Omit<FubonOutlook, 'id' | 'createdAt'>> {
  const research = await runWebResearch({ prompt: buildFubonDigestPrompt(today), maxSearches: 2 }, clients?.research)
  const extraction = await extractStructured(
    FubonOutlookContentSchema,
    FUBON_DIGEST_EXTRACTION_INSTRUCTIONS,
    research.markdown,
    clients?.extraction,
  )
  if (!extraction.data.reportTitle) {
    throw new Error('這次沒有讀取到富邦報告，請稍後再試，或到報告列表確認網站是否正常。')
  }
  return {
    ...extraction.data,
    pdfUrl: fubonUsage(research.sources).report?.url ?? '',
    markdown: research.markdown,
    sources: research.sources,
    estimatedCostUsd: research.estimatedCostUsd + extraction.estimatedCostUsd,
  }
}
