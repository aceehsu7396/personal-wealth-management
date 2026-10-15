import { describe, expect, it } from 'vitest'
import { AppDataSchema, createDefaultAppData } from './schema'

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
})
