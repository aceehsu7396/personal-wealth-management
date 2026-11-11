// A section of a page: a heading, an optional one-line description and at
// most one action at the top right (docs/ui-guidelines.md §4).
export function Card({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>}
          {action}
        </div>
      )}
      {description && <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  )
}
