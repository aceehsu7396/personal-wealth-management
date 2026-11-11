import { Navigate, useParams } from 'react-router-dom'
import { MarkdownView } from '../components/MarkdownView'

// Temporary page: the planning blueprint in docs/blueprint/, one tab per
// document ("00-總覽.md" → /blueprint/00). Planning only, not the method.
const docs = import.meta.glob('../../docs/blueprint/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const bySlug = Object.fromEntries(
  Object.entries(docs).map(([path, content]) => [decodeURIComponent(path).split('/').pop()!.split('-')[0], content]),
)

// Links between the documents ("01-知識與方法論.md") stay on this page;
// app routes ("/handbook/05") stay in the app.
function resolveLink(href: string): string | null {
  if (href.startsWith('/')) return href
  const file = decodeURIComponent(href.split('#')[0])
  const slug = file.match(/^(\d\d)-.+\.md$/)?.[1]
  return slug && bySlug[slug] ? `/blueprint/${slug}` : null
}

export function BlueprintPage() {
  const { slug } = useParams()
  const content = slug ? bySlug[slug] : undefined
  // A bare /blueprint opens the overview tab, so the tab bar shows.
  if (!content) return <Navigate to="/blueprint/00" replace />
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        規劃文件，尚未實作；整理於 2026-11-11。以股市投資達成財富自由為目標，從頭規劃分析局勢、應對策略與風險管理的完整系統，並對照現有平台的差距與建置路線。
      </p>
      <article className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <MarkdownView content={content} resolveLink={resolveLink} />
      </article>
    </div>
  )
}
