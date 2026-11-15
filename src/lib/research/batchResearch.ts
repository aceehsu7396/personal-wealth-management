import type { StockThesis } from '../storage/schema'
import { buildAutoResearch, derivedFields, type AutoResearch } from './autoResearch'

// Research several screener picks in one go (handbook 06 §1): each gets the
// automatic health check and a new research card waiting for a verdict.

export type ThesisValues = Omit<StockThesis, 'id' | 'createdAt' | 'updatedAt'>

// Fields the scoring no longer reads but the stored card still carries.
export function blankThesis(): ThesisValues {
  return {
    ticker: '',
    name: '',
    market: 'TW',
    sector: '',
    lynchCategory: 'stalwart',
    inCircleOfCompetence: true,
    status: 'watch',
    thesis: '',
    drivers: '',
    killCriteria: '',
    sources: '',
    preMortem: '',
    fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
    powers: { scaleEconomies: 0, networkEconomies: 0, counterPositioning: 0, switchingCosts: 0, branding: 0, corneredResource: 0, processPower: 0 },
    fScore: 0,
    hasUnexplainedRedFlags: false,
    fairValueBear: 0,
    fairValueBase: 0,
    fairValueBull: 0,
    currentPrice: 0,
    kind: 'stock',
    verdictNote: '',
    explainedFlags: {},
    fiveForcesRated: false,
  }
}

// The card fields that come from a health check.
export function autoThesisFields(code: string, auto: AutoResearch) {
  return {
    ticker: code.trim().toUpperCase(),
    market: 'TW' as const,
    name: auto.name,
    sector: auto.industry,
    kind: auto.kind,
    auto,
    lynchCategory: auto.stock?.lynch ?? blankThesis().lynchCategory,
    assumptions: undefined,
    explainedFlags: {},
    ...derivedFields(auto, undefined, {}),
  }
}

// A new card with no verdict yet: the user decides after reading it.
export const draftThesis = (code: string, auto: AutoResearch): ThesisValues => ({ ...blankThesis(), ...autoThesisFields(code, auto) })

// FinMind's free quota is hourly; more than this in one go usually runs out.
export const BATCH_SUGGESTED_MAX = 5

export interface BatchProgress {
  code: string
  done: number
  total: number
}

export interface BatchOutcome {
  done: { code: string; auto: AutoResearch }[]
  failed: { code: string; error: string }[]
  // Codes not tried because the quota ran out.
  pending: string[]
}

const quotaError = (e: unknown) => e instanceof Error && e.message.includes('額度')

// One stock at a time, so the cache and quota are shared; a quota error
// stops the batch and leaves the rest for later.
export async function researchBatch(
  codes: string[],
  today: string,
  { onProgress, buildAuto = buildAutoResearch }: { onProgress?: (p: BatchProgress) => void; buildAuto?: (code: string, today: string) => Promise<AutoResearch> } = {},
): Promise<BatchOutcome> {
  const out: BatchOutcome = { done: [], failed: [], pending: [] }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    onProgress?.({ code, done: i, total: codes.length })
    try {
      out.done.push({ code, auto: await buildAuto(code, today) })
    } catch (e) {
      out.failed.push({ code, error: e instanceof Error ? e.message : String(e) })
      if (quotaError(e)) {
        out.pending = codes.slice(i + 1)
        break
      }
    }
  }
  return out
}
