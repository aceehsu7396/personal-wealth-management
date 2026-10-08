import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

function makeComponents(resolveLink?: (href: string) => string | null): Components {
  return {
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
    const internal = resolveLink?.(href) ?? null
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
}

// Renders Markdown with the app's typography (handbook chapters, AI research
// reports). `resolveLink` maps a relative link to an in-app route.
export function MarkdownView({
  content,
  resolveLink,
}: {
  content: string
  resolveLink?: (href: string) => string | null
}) {
  const components = useMemo(() => makeComponents(resolveLink), [resolveLink])
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
