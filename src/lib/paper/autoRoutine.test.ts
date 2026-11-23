import { describe, expect, it } from 'vitest'
import { claimRoutine, closeDue, releaseRoutine, routineDue, taipeiDate } from './autoRoutine'

// Taiwan time is UTC+8: 14:30 there is 06:30Z.
const at = (iso: string) => new Date(iso)

describe('closeDue', () => {
  it('is today from 14:30 on a weekday, the weekday before otherwise', () => {
    // Monday 2026-11-23.
    expect(closeDue(at('2026-11-23T06:30:00Z'))).toBe('2026-11-23')
    expect(closeDue(at('2026-11-23T06:29:00Z'))).toBe('2026-11-20')
    // Monday 07:00 Taiwan (Sunday 23:00Z).
    expect(closeDue(at('2026-11-22T23:00:00Z'))).toBe('2026-11-20')
    // Saturday and Sunday.
    expect(closeDue(at('2026-11-21T10:00:00Z'))).toBe('2026-11-20')
    expect(closeDue(at('2026-11-22T10:00:00Z'))).toBe('2026-11-20')
  })
})

describe('routineDue', () => {
  it('runs once after each close', () => {
    const after = at('2026-11-23T07:00:00Z')
    expect(routineDue(after, undefined)).toBe(true)
    // Ran this morning, before the close.
    expect(routineDue(after, '2026-11-23T01:00:00Z')).toBe(true)
    // Ran after today's close.
    expect(routineDue(after, '2026-11-23T06:45:00Z')).toBe(false)
    // Ran Friday after the close: due again only after Monday's.
    expect(routineDue(at('2026-11-22T10:00:00Z'), '2026-11-20T08:00:00Z')).toBe(false)
    expect(routineDue(at('2026-11-23T02:00:00Z'), '2026-11-20T08:00:00Z')).toBe(false)
    expect(routineDue(after, '2026-11-20T08:00:00Z')).toBe(true)
    // Missed Friday's close: catches up on the weekend.
    expect(routineDue(at('2026-11-21T03:00:00Z'), '2026-11-19T08:00:00Z')).toBe(true)
  })

  it('reads timestamps in Taiwan time', () => {
    expect(taipeiDate('2026-11-22T23:00:00Z')).toBe('2026-11-23')
  })
})

describe('run lock', () => {
  it('lets one routine run at a time', () => {
    expect(claimRoutine()).toBe(true)
    expect(claimRoutine()).toBe(false)
    releaseRoutine()
    expect(claimRoutine()).toBe(true)
    releaseRoutine()
  })
})
