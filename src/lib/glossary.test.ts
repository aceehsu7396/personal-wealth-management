import { describe, expect, it } from 'vitest'
import appendix from '../../docs/strategy/附錄B-名詞解釋.md?raw'
import { GLOSSARY } from './glossary'

describe('glossary', () => {
  it('matches handbook appendix B word for word', () => {
    for (const [term, text] of Object.entries(GLOSSARY)) expect(appendix).toContain(`| ${term} | ${text} |`)
  })
})
