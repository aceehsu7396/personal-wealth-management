import { describe, expect, it } from 'vitest'
import type { AutoResearch } from './autoResearch'
import { researchBatch } from './batchResearch'

const fake = (code: string) => ({ code, name: code, industry: '半導體業', kind: 'stock' }) as unknown as AutoResearch

describe('researchBatch', () => {
  it('researches each code in turn and keeps going past a bad code', async () => {
    const seen: string[] = []
    const out = await researchBatch(['2330', '9999', '2317'], '2026-11-15', {
      onProgress: (p) => seen.push(`${p.code} ${p.done}/${p.total}`),
      buildAuto: async (code) => {
        if (code === '9999') throw new Error('FinMind 查無 9999')
        return fake(code)
      },
    })
    expect(out.done.map((d) => d.code)).toEqual(['2330', '2317'])
    expect(out.failed).toEqual([{ code: '9999', error: 'FinMind 查無 9999' }])
    expect(out.pending).toEqual([])
    expect(seen).toEqual(['2330 0/3', '9999 1/3', '2317 2/3'])
  })

  it('stops when the free quota runs out and leaves the rest for later', async () => {
    const out = await researchBatch(['2330', '2317', '2454', '2412'], '2026-11-15', {
      buildAuto: async (code) => {
        if (code === '2317') throw new Error('FinMind 免費額度暫時用完，請一小時後再試。')
        return fake(code)
      },
    })
    expect(out.done.map((d) => d.code)).toEqual(['2330'])
    expect(out.failed.map((f) => f.code)).toEqual(['2317'])
    expect(out.pending).toEqual(['2454', '2412'])
  })
})
