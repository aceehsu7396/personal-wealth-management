import { describe, expect, it } from 'vitest'
import { buildHandbook, HANDBOOK, parseTitle, resolveDocHref, slugOf } from './handbook'

describe('slugOf / parseTitle', () => {
  it('derives slugs and titles from file names and headings', () => {
    expect(slugOf('README.md')).toBe('index')
    expect(slugOf('01-第一步-財務地基.md')).toBe('01')
    expect(slugOf('附錄A-方法論對照.md')).toBe('附錄A')
    expect(parseTitle('# 03 財務與價值評估\n', 'x.md')).toEqual({ number: '03', title: '財務與價值評估' })
    expect(parseTitle('# 個人長期策略投資手冊', 'README.md')).toEqual({ number: null, title: '個人長期策略投資手冊' })
  })
})

describe('buildHandbook', () => {
  it('orders the overview first, then numbered chapters, then appendices', () => {
    const docs = buildHandbook({
      'x/02-b.md': '# 02 B',
      'x/附錄A-z.md': '# 附錄A Z',
      'x/README.md': '# 總覽',
      'x/00-a.md': '# 00 A',
    })
    expect(docs.map((d) => d.slug)).toEqual(['index', '00', '02', '附錄A'])
  })
})

describe('resolveDocHref', () => {
  const docs = buildHandbook({ 'x/04-投資組合策略與風險.md': '# 04 組合' })

  it('maps relative and URL-encoded handbook links to in-app routes', () => {
    expect(resolveDocHref('04-投資組合策略與風險.md', docs)).toBe('/handbook/04')
    expect(resolveDocHref(encodeURI('04-投資組合策略與風險.md') + '#6', docs)).toBe('/handbook/04')
  })

  it('leaves external and unknown links alone', () => {
    expect(resolveDocHref('https://fred.stlouisfed.org', docs)).toBeNull()
    expect(resolveDocHref('#section', docs)).toBeNull()
    expect(resolveDocHref('missing.md', docs)).toBeNull()
  })
})

describe('HANDBOOK', () => {
  it('bundles every strategy document and every internal link resolves', () => {
    expect(HANDBOOK.map((d) => d.slug)).toEqual([
      'index', '00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '附錄A',
    ])
    for (const doc of HANDBOOK) {
      for (const [, href] of doc.content.matchAll(/\]\(([^)]+\.md[^)]*)\)/g)) {
        expect(resolveDocHref(href, HANDBOOK), `${doc.fileName} → ${href}`).not.toBeNull()
      }
    }
  })
})
