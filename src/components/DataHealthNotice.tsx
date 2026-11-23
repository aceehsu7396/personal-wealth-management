import { Link } from 'react-router-dom'
import { useDataHealth } from '../lib/data/useDataHealth'

// One line at the top when a data item stayed old after hours of automatic
// repair (handbook 附錄 C §7); items still being repaired stay quiet.
export function DataHealthNotice() {
  const health = useDataHealth()
  const stale = health?.items.filter((i) => i.status === 'stale') ?? []
  if (stale.length === 0) return null
  const first = stale[0]
  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
        <span className="font-semibold">資料停在舊的日期</span>
        <span className="text-xs">
          {first.label}：{first.note}，自動修復沒有成功{stale.length > 1 ? `（另有 ${stale.length - 1} 項）` : ''}。頁面仍顯示最後一份正確的資料。
        </span>
        <Link to="/settings" className="ml-auto text-xs font-medium underline">
          看資料狀態
        </Link>
      </div>
    </div>
  )
}
