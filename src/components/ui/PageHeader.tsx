// Page heading: what the page is for in one sentence, and its one main
// action (docs/ui-guidelines.md §2).
export function PageHeader({ title, summary, action }: { title: string; summary: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-prose">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{summary}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}

export const primaryButton =
  'inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50'
export const secondaryButton =
  'inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
export const textLink = 'text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-400'
