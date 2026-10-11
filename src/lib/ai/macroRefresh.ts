import type { FubonOutlook } from '../storage/schema'
import { isOutlookFresh, latestOutlook } from '../calculations/fubonTracking'
import { digestFubonOutlook } from './fubonOutlook'
import { analyzeMarket, macroDraftToForm, type MacroDraftValues } from './analyses'
import type { ResearchClient, ResearchResult } from './webResearch'
import type { ExtractionClient } from './extractStructured'
import { describeAiError } from './client'

type Clients = { research?: ResearchClient; extraction?: ExtractionClient }

// Fubon publishes once a month; re-digest only when the stored digest is
// from an earlier month (the new issue may be out).
export function needsNewDigest(latest: FubonOutlook | undefined, today: string): boolean {
  return !latest || latest.reportDate.slice(0, 7) < today.slice(0, 7)
}

export interface MacroRefreshResult {
  // A newly digested report to store (undefined when the stored one was reused).
  newOutlook?: Omit<FubonOutlook, 'id' | 'createdAt'>
  // Why digesting failed; the analysis then read the PDF or searched itself.
  digestError?: string
  research: ResearchResult
  checkIn: MacroDraftValues & { reasons: Record<string, string> }
  usedOutlook: boolean
  estimatedCostUsd: number
}

// One button, the whole monthly macro review: digest the latest Fubon
// outlook, search only the signals it does not cover, and turn the result
// into the month's check-in.
export async function refreshMacro(
  today: string,
  stored: FubonOutlook[],
  clients?: { digest?: Clients; analysis?: Clients },
  onStep?: (step: 'digest' | 'analysis') => void,
): Promise<MacroRefreshResult> {
  let outlook = latestOutlook(stored)
  let newOutlook: MacroRefreshResult['newOutlook']
  let digestError: string | undefined
  let cost = 0

  if (needsNewDigest(outlook, today)) {
    onStep?.('digest')
    try {
      newOutlook = await digestFubonOutlook(today, clients?.digest)
      cost += newOutlook.estimatedCostUsd
      outlook = { ...newOutlook, id: '', createdAt: '' }
    } catch (e) {
      digestError = describeAiError(e)
    }
  }

  const usable = outlook && isOutlookFresh(outlook, today) ? outlook : undefined
  onStep?.('analysis')
  const result = await analyzeMarket(today, clients?.analysis, usable)
  if (!result.facts) throw new Error('這次沒有取得完整的總經訊號，請稍後再試。')
  const { values, reasons } = macroDraftToForm(result.facts, today)
  return {
    newOutlook,
    digestError,
    research: result.research,
    checkIn: { ...values, reasons },
    usedOutlook: usable !== undefined,
    estimatedCostUsd: cost + result.estimatedCostUsd,
  }
}
