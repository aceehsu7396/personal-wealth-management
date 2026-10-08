import { Link, useLocation } from 'react-router-dom'
import { groupOf, NAV_GROUPS, tabMatches } from './navigation'

function itemClass(active: boolean): string {
  return `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
  }`
}

function tabClass(active: boolean): string {
  return `whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
    active
      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
      : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
  }`
}

export function NavBar() {
  const { pathname } = useLocation()
  const current = groupOf(pathname)

  return (
    <>
      <nav className="border-b border-black bg-gray-950">
        <div className="mx-auto flex max-w-4xl items-center gap-2 overflow-x-auto px-4 py-3">
          <span className="mr-2 flex shrink-0 items-center gap-2 text-sm font-semibold text-white">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-orange-500" />
            個人財富管理工具
          </span>
          {NAV_GROUPS.map((g) => (
            <Link key={g.id} to={g.to} className={itemClass(current?.id === g.id)}>
              {g.label}
            </Link>
          ))}
        </div>
      </nav>
      {current && current.tabs.length > 1 && (
        <div className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4">
            {current.tabs.map((t) => (
              <Link key={t.to} to={t.to} className={tabClass(tabMatches(t, pathname))}>
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
