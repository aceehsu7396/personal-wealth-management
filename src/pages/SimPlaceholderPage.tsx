import { Link } from 'react-router-dom'

// Shown for simulation tabs that are not built yet.
export function SimPlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
      <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
        這個功能正在建置中，即將上線。可以先到{' '}
        <Link to="/sim/strategies" className="font-medium text-indigo-700 underline dark:text-indigo-400">
          策略卡
        </Link>{' '}
        寫下交易計畫，或閱讀手冊{' '}
        <Link to="/handbook/10" className="font-medium text-indigo-700 underline dark:text-indigo-400">
          10 交易策略開發與回測
        </Link>
        。
      </p>
    </div>
  )
}
