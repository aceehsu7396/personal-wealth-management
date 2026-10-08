import { Link } from 'react-router-dom'

// Button for a paid AI research run, with the cost note, progress and error.
export function AiActionButton({
  label,
  running,
  error,
  hasApiKey,
  onClick,
  disabled = false,
  costNote = '每次約 US$0.1–0.5，使用你的 Anthropic API 金鑰',
}: {
  label: string
  running: boolean
  error: string | null
  hasApiKey: boolean
  onClick: () => void
  disabled?: boolean
  costNote?: string
}) {
  if (!hasApiKey) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        到{' '}
        <Link to="/settings" className="font-medium text-indigo-700 underline dark:text-indigo-400">
          設定
        </Link>{' '}
        填入 Anthropic API 金鑰後，即可使用 AI 網路研究。
      </p>
    )
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={running || disabled}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? '搜尋與整理中…（約 1–3 分鐘）' : label}
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">{costNote}</span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
