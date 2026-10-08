import { useEffect } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { MarkdownView } from '../components/MarkdownView'
import { CHAPTER_PAGES, HANDBOOK, resolveDocHref, type HandbookDoc } from '../lib/handbook'

function resolveHandbookLink(href: string): string | null {
  return resolveDocHref(href, HANDBOOK)
}

function navLabel(doc: HandbookDoc): string {
  return doc.slug === 'index' ? '總覽與閱讀順序' : doc.title
}

export function HandbookPage() {
  const { slug = 'index' } = useParams()
  const navigate = useNavigate()
  const index = HANDBOOK.findIndex((d) => d.slug === slug)
  const doc = HANDBOOK[index]

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [slug])

  if (!doc) return <Navigate to="/handbook" replace />

  const prev = HANDBOOK[index - 1]
  const next = HANDBOOK[index + 1]
  const practice = CHAPTER_PAGES[slug]

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        <aside className="mb-6 lg:mb-0">
          <label className="block lg:hidden">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">章節</span>
            <select
              value={slug}
              onChange={(e) => navigate(`/handbook/${e.target.value}`)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {HANDBOOK.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.number ? `${d.number} ` : ''}
                  {navLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <nav className="sticky top-6 hidden lg:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              策略手冊
            </p>
            <ul className="space-y-1">
              {HANDBOOK.map((d) => (
                <li key={d.slug}>
                  <Link
                    to={`/handbook/${d.slug}`}
                    className={`block rounded-md px-3 py-2 text-sm ${
                      d.slug === slug
                        ? 'bg-indigo-600 font-medium text-white'
                        : 'text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {d.number && <span className="mr-1 font-mono text-xs opacity-70">{d.number}</span>}
                    {navLabel(d)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 rounded-lg border border-gray-200 bg-white p-6 sm:p-8 dark:border-gray-700 dark:bg-gray-800">
          {practice && (
            <Link
              to={practice.to}
              className="mb-4 inline-block rounded-md border sm:float-right sm:mb-0 sm:ml-4 border-indigo-600 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
            >
              前往「{practice.label}」實作 →
            </Link>
          )}
          <MarkdownView content={doc.content} resolveLink={resolveHandbookLink} />

          <div className="mt-12 flex flex-wrap justify-between gap-3 border-t border-gray-200 pt-6 text-sm dark:border-gray-700">
            {prev ? (
              <Link to={`/handbook/${prev.slug}`} className="text-indigo-700 hover:underline dark:text-indigo-400">
                ← {navLabel(prev)}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/handbook/${next.slug}`} className="text-indigo-700 hover:underline dark:text-indigo-400">
                {navLabel(next)} →
              </Link>
            )}
          </div>
        </article>
      </div>
    </div>
  )
}
