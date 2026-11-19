// One group of a research list: a header that opens or folds it, with the
// count, styled like the strategy card groups.
export function ListGroup({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {open ? '▾' : '▸'} {label}
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-400">{count} 檔</span>
      </button>
      {open && <ul className="border-t border-gray-100 px-4 dark:border-gray-700">{children}</ul>}
    </section>
  )
}
