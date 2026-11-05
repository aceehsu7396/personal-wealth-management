import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { STORAGE_FULL_EVENT } from '../lib/storage/cacheCleanup'

// Shown when the browser refuses to save the app data even after the
// download caches were cleared: changes would otherwise vanish on reload.
export function StorageWarning() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onFull = () => setFull(true)
    window.addEventListener(STORAGE_FULL_EVENT, onFull)
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull)
  }, [])
  if (!full) return null
  return (
    <div role="alert" className="border-b border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-red-900 dark:text-red-100">
        <span className="font-semibold">資料沒有儲存</span>
        <span className="text-xs">瀏覽器的儲存空間已滿，剛才的修改在重新整理後會消失。請先匯出備份，再刪除不需要的回測紀錄。</span>
        <Link to="/settings" className="ml-auto text-xs font-medium underline">
          前往設定匯出資料
        </Link>
      </div>
    </div>
  )
}
