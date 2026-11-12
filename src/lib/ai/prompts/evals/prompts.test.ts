import { describe, expect, it } from 'vitest'
import { coachPrompt, eventMonitorPrompt, planPrompt, redTeamPrompt, regimePrompt, reviewerPrompt } from '../agents'
import { GUARDRAILS, PROMPT_LIMIT, redact } from '../common'
import { COACH_CASES, EVENT_CASES, PLAN_CASES, RED_TEAM_CASES, REGIME_CASES, REVIEWER_CASES, type EvalCase } from './cases'

// Prompt evals (stage 6): every template, on every fixed case, must carry
// its facts and the guardrails, hide amounts by default and stay short.
// A failing case blocks the template from shipping.

function check<T>(label: string, cases: EvalCase<T>[], build: (x: T) => string) {
  describe(label, () => {
    for (const c of cases) {
      it(c.name, () => {
        const p = build(c.input)
        for (const g of GUARDRAILS) expect(p).toContain(g)
        for (const fact of c.mustInclude) expect(p).toContain(fact)
        expect(p).not.toMatch(/NT\$\s?[\d,]/)
        expect(p.length).toBeLessThanOrEqual(PROMPT_LIMIT)
      })
    }
  })
}

check('事件監控', EVENT_CASES, eventMonitorPrompt)
check('進出場助手', PLAN_CASES, planPrompt)
check('局勢解讀', REGIME_CASES, regimePrompt)
check('紅隊', RED_TEAM_CASES, redTeamPrompt)
check('交易教練', COACH_CASES, coachPrompt)
check('檢討員', REVIEWER_CASES, reviewerPrompt)

describe('amounts', () => {
  it('hides NT$ amounts and long figures unless asked', () => {
    expect(redact('停損時虧損 NT$62,780，總額 8,209,533 元')).toBe('停損時虧損 （金額已隱藏），總額 （金額已隱藏）')
    expect(redact('除息 4.5 元、收盤 2,180')).toBe('除息 4.5 元、收盤 2,180')
    expect(planPrompt({ ...PLAN_CASES[0].input, includeAmounts: true })).toContain('NT$62,780')
  })

  it('truncates long data but keeps the rules', () => {
    const p = eventMonitorPrompt({ today: '2026-11-12', items: Array.from({ length: 400 }, (_, i) => ({ level: '提醒', text: `第 ${i} 項很長的事件說明`.repeat(3), basis: '測試' })) })
    expect(p.length).toBeLessThanOrEqual(PROMPT_LIMIT)
    expect(p).toContain(GUARDRAILS[1])
    expect(p).toContain('已截斷')
  })
})
