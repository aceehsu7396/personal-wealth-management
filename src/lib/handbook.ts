// Strategy handbook: the Markdown files under docs/strategy, bundled as raw
// text so the app can render them in place.
const rawDocs = import.meta.glob('../../docs/strategy/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface HandbookDoc {
  slug: string
  fileName: string
  number: string | null
  title: string
  content: string
}

// App page that puts each chapter into practice.
export const CHAPTER_PAGES: Record<string, { to: string; label: string }> = {
  '00': { to: '/journey', label: '行動路線' },
  '01': { to: '/journey', label: '行動路線' },
  '02': { to: '/strategy', label: '投資策略' },
  '03': { to: '/portfolio', label: '投資組合' },
  '04': { to: '/trades', label: '交易日誌' },
  '05': { to: '/market', label: '市場檢視' },
  '06': { to: '/research', label: '個股研究' },
  '07': { to: '/research', label: '個股研究' },
  '08': { to: '/portfolio', label: '投資組合' },
  '09': { to: '/journey', label: '行動路線' },
}

export function slugOf(fileName: string): string {
  if (fileName === 'README.md') return 'index'
  return fileName.split('-')[0]
}

// "# 03 核心配置與定期定額" → number "03", title "核心配置與定期定額".
export function parseTitle(content: string, fileName: string): { number: string | null; title: string } {
  const heading = content.split('\n').find((line) => line.startsWith('# '))
  const text = heading ? heading.slice(2).trim() : fileName.replace(/\.md$/, '')
  const match = /^(\d+[a-z]?)\s+(.+)$/.exec(text)
  return match ? { number: match[1], title: match[2] } : { number: null, title: text }
}

// Overview first, then numbered chapters, then appendices (e.g. 附錄A).
function orderKey(slug: string): number {
  if (slug === 'index') return -1
  const n = Number.parseInt(slug, 10)
  return Number.isNaN(n) ? 1000 : n
}

export function buildHandbook(files: Record<string, string>): HandbookDoc[] {
  return Object.entries(files)
    .map(([path, content]) => {
      const fileName = path.split('/').pop()!
      const { number, title } = parseTitle(content, fileName)
      return { slug: slugOf(fileName), fileName, number, title, content }
    })
    .sort((a, b) => orderKey(a.slug) - orderKey(b.slug))
}

// Maps a relative link between handbook files (e.g. "04-投資組合策略與風險.md")
// to its in-app route. Returns null for anything that is not a handbook file.
export function resolveDocHref(href: string, docs: HandbookDoc[]): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return null
  const target = decodeURIComponent(href.split('#')[0]).split('/').pop()
  const doc = docs.find((d) => d.fileName === target)
  return doc ? `/handbook/${doc.slug}` : null
}

export const HANDBOOK: HandbookDoc[] = buildHandbook(rawDocs)
