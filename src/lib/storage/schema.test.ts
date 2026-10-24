import { describe, expect, it } from 'vitest'
import { AppDataSchema, StockThesisSchema, createDefaultAppData } from './schema'

describe('AppDataSchema', () => {
  it('loads data saved before the action roadmap fields existed', () => {
    const current = createDefaultAppData()
    const { foundation: _foundation, ...older } = current
    const { signedAt: _signedAt, ...olderPolicy } = current.investmentPolicy
    const result = AppDataSchema.safeParse({ ...older, investmentPolicy: olderPolicy })
    expect(result.success).toBe(true)
    expect(result.data?.foundation).toEqual({ emergencyFundAmount: 0, emergencyFundTargetMonths: 6, livingBufferMonths: 24 })
    expect(result.data?.investmentPolicy.signedAt).toBeUndefined()
  })

  it('fills trading-sleeve rules and empty simulation data for older saves', () => {
    const current = createDefaultAppData()
    const { tradingStrategies: _s, backtestRuns: _b, paperAccounts: _p, watchlist: _w, ...older } = current
    const { riskPerTradePercent: _r, maxOpenPositions: _m, requireStopLoss: _q, ...olderPolicy } = current.investmentPolicy
    const { livingBufferMonths: _l, ...olderFoundation } = current.foundation
    const result = AppDataSchema.safeParse({ ...older, investmentPolicy: olderPolicy, foundation: olderFoundation })
    expect(result.success).toBe(true)
    expect(result.data?.investmentPolicy).toMatchObject({ riskPerTradePercent: 1, maxOpenPositions: 8, requireStopLoss: true })
    expect(result.data?.foundation.livingBufferMonths).toBe(24)
    expect(result.data?.tradingStrategies).toEqual([])
    expect(result.data?.paperAccounts).toEqual([])
    expect(result.data?.watchlist).toEqual([])
  })

  it('loads research cards saved before the automatic health check', () => {
    const card = {
      id: 'x', ticker: '2330', name: '台積電', market: 'TW', sector: '半導體', lynchCategory: 'stalwart',
      inCircleOfCompetence: true, status: 'watch', thesis: 'a', drivers: 'b', killCriteria: 'c', sources: 'd', preMortem: 'e',
      fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
      powers: { scaleEconomies: 3, networkEconomies: 0, counterPositioning: 0, switchingCosts: 0, branding: 0, corneredResource: 0, processPower: 0 },
      fScore: 7, hasUnexplainedRedFlags: false, fairValueBear: 1, fairValueBase: 2, fairValueBull: 3, currentPrice: 2,
      updatedAt: '', createdAt: '',
    }
    const parsed = StockThesisSchema.parse(card)
    expect(parsed).toMatchObject({ kind: 'stock', verdictNote: '', explainedFlags: {} })
    expect(parsed.verdict).toBeUndefined()
    expect(parsed.fiveForcesRated).toBeUndefined()
  })

  it('loads ETF and financial cards saved without an F-score', () => {
    const card = {
      id: 'x', ticker: '00878', name: '國泰永續高股息', market: 'TW', sector: 'ETF', lynchCategory: 'stalwart',
      inCircleOfCompetence: true, status: 'watch', thesis: '', drivers: '', killCriteria: '', sources: '', preMortem: '',
      fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
      powers: { scaleEconomies: 0, networkEconomies: 0, counterPositioning: 0, switchingCosts: 0, branding: 0, corneredResource: 0, processPower: 0 },
      hasUnexplainedRedFlags: false, fairValueBear: 0, fairValueBase: 0, fairValueBull: 0, currentPrice: 35,
      kind: 'etf', updatedAt: '', createdAt: '',
    }
    expect(StockThesisSchema.parse(card).fScore).toBe(0)
  })
})
