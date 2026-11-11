// The reasons and details under a conclusion, collapsed by default.
export function Disclosure({ summary, children, defaultOpen = false }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group mt-3 text-sm">
      <summary className="cursor-pointer text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">{summary}</summary>
      <div className="mt-2 text-gray-700 dark:text-gray-300">{children}</div>
    </details>
  )
}
