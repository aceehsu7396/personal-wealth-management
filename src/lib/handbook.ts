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
  '00': { to: '/strategy', label: '投資策略' },
  '01': { to: '/market', label: '市場檢視' },
  '02': { to: '/research', label: '個股研究' },
  '03': { to: '/research', label: '個股研究' },
  '04': { to: '/portfolio', label: '投資組合' },
  '05': { to: '/trades', label: '交易日誌' },
}

export function slugOf(fileName: string): string {
  if (fileName === 'README.md') return 'index'
  return fileName.split('-')[0]
}

// "# 00a 策略總架構與方法論" → number "00a", title "策略總架構與方法論".
export function parseTitle(content: string, fileName: string): { number: string | null; title: string } {
  const heading = content.split('\n').find((line) => line.startsWith('# '))
  const text = heading ? heading.slice(2).trim() : fileName.replace(/\.md$/, '')
  const match = /^(\d+[a-z]?)\s+(.+)$/.exec(text)
  return match ? { number: match[1], title: match[2] } : { number: null, title: text }
}

// Overview first, then 00a, 00, 01, 02, … in reading order.
function orderKey(slug: string): number {
  if (slug === 'index') return -2
  if (slug === '00a') return -1
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
