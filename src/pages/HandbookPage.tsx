import { useEffect } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CHAPTER_PAGES, HANDBOOK, resolveDocHref, type HandbookDoc } from '../lib/handbook'

function navLabel(doc: HandbookDoc): string {
  return doc.slug === 'index' ? '總覽與閱讀順序' : doc.title
}

// Plain text of a Markdown (hast) node, used to spot the「本章行動」box.
interface TextNode {
  type?: string
  value?: string
  children?: TextNode[]
}
function textOf(node: TextNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-base font-semibold text-gray-900 dark:text-gray-100">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-3 leading-7 text-gray-700 dark:text-gray-300">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-1 pl-6 leading-7 text-gray-700 dark:text-gray-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1 pl-6 leading-7 text-gray-700 dark:text-gray-300">{children}</ol>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
  ),
  blockquote: ({ node, children }) =>
    textOf(node).trim().startsWith('本章行動') ? (
      <blockquote className="mt-4 rounded-md border border-indigo-300 bg-indigo-50 px-5 py-2 text-gray-800 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-gray-200 [&>p]:my-2 [&_ul]:mt-1">
        {children}
      </blockquote>
    ) : (
    <blockquote className="mt-4 rounded-r-md border-l-4 border-orange-400 bg-orange-50 px-4 py-1 text-gray-700 dark:bg-orange-900/20 dark:text-gray-300 [&>p]:my-2">
      {children}
    </blockquote>
    ),
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b-2 border-gray-200 px-3 py-2 font-semibold text-gray-900 dark:border-gray-600 dark:text-gray-100">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-gray-100 px-3 py-2 align-top text-gray-700 dark:border-gray-700 dark:text-gray-300">
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-md bg-gray-100 p-4 font-mono text-[13px] leading-6 text-gray-800 dark:bg-gray-900 dark:text-gray-200 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-gray-900">{children}</code>
  ),
  hr: () => <hr className="my-8 border-gray-200 dark:border-gray-700" />,
  a: ({ href = '', children }) => {
    const internal = resolveDocHref(href, HANDBOOK)
    const className = 'font-medium text-indigo-700 hover:underline dark:text-indigo-400'
    if (internal) {
      return (
        <Link to={internal} className={className}>
          {children}
        </Link>
      )
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    )
  },
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {doc.content}
          </ReactMarkdown>

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
