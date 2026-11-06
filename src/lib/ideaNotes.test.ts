import { describe, expect, it } from 'vitest'
import { GENERAL_NODE, groupByArea, notesToMarkdown, sortNotes } from './ideaNotes'
import type { IdeaNote } from './storage/schema'

const note = (over: Partial<IdeaNote>): IdeaNote => ({
  id: over.title ?? 'n',
  nodeId: 'screener',
  title: 'n',
  detail: '',
  status: 'idea',
  priority: 'medium',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

describe('ideaNotes', () => {
  it('groups by the three areas in map order, general first', () => {
    const areas = groupByArea([note({ title: 'a', nodeId: 'paper' }), note({ title: 'b', nodeId: 'gone' })])
    expect(areas.map((a) => a.title)).toEqual(['整體／跨項目', '研究分析', '模擬交易', '投資持有與檢討回顧'])
    expect(areas[0].nodes[0]).toMatchObject({ id: GENERAL_NODE, notes: [{ title: 'b' }] })
    expect(areas[2].nodes.find((n) => n.id === 'paper')?.notes.map((n) => n.title)).toEqual(['a'])
  })

  it('puts open ideas first, then by priority and recency', () => {
    const sorted = sortNotes([
      note({ title: 'done', status: 'done', priority: 'high' }),
      note({ title: 'low', priority: 'low' }),
      note({ title: 'old high', priority: 'high' }),
      note({ title: 'new high', priority: 'high', updatedAt: '2026-11-05T00:00:00Z' }),
    ])
    expect(sorted.map((n) => n.title)).toEqual(['new high', 'old high', 'low', 'done'])
  })

  it('exports Markdown by area and part, only parts with notes', () => {
    const md = notesToMarkdown(
      [
        note({ title: '依產業分組', detail: '觀察名單\n太長', priority: 'high', page: '/research/screener' }),
        note({ title: '回測加手續費', nodeId: 'backtest', status: 'done' }),
        note({ title: '改成三大項目', nodeId: GENERAL_NODE, status: 'planned' }),
      ],
      '2026-11-06',
    )
    expect(md).toContain('# 精進筆記（2026-11-06，共 3 則）')
    expect(md).toContain('## 整體／跨項目\n\n### 整體／跨項目\n- [ ] 〔中〕〔規劃中〕改成三大項目（2026-11-01）')
    expect(md).toContain('### 選股與觀察名單（頁面 /research/screener；手冊 附錄 B 名詞解釋）')
    expect(md).toContain('- [ ] 〔高〕依產業分組 — 觀察名單 太長（記於 /research/screener，2026-11-01）')
    expect(md).toContain('- [x] 〔中〕回測加手續費')
    expect(md).not.toContain('### 虛擬帳戶')
  })
})
