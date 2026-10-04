import { describe, expect, it } from 'vitest'
import { AppDataSchema, createDefaultAppData } from './schema'

describe('AppDataSchema', () => {
  it('loads data saved before the action roadmap fields existed', () => {
    const current = createDefaultAppData()
    const { foundation: _foundation, ...older } = current
    const { signedAt: _signedAt, ...olderPolicy } = current.investmentPolicy
    const result = AppDataSchema.safeParse({ ...older, investmentPolicy: olderPolicy })
    expect(result.success).toBe(true)
    expect(result.data?.foundation).toEqual({ emergencyFundAmount: 0, emergencyFundTargetMonths: 6 })
    expect(result.data?.investmentPolicy.signedAt).toBeUndefined()
  })
})
