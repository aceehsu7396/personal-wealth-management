import { useRef, useState } from 'react'
import { useAppStore, exportAppData } from '../lib/storage/appStore'
import { AppDataSchema } from '../lib/storage/schema'

const buttonClass =
  'rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'

export function DataManagement() {
  const importData = useAppStore((s) => s.importData)
  const resetAllData = useAppStore((s) => s.resetAllData)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importMessage, setImportMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [pendingReset, setPendingReset] = useState(false)

  function handleExport() {
    const data = exportAppData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `個人財富管理工具-備份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(file: File) {
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text)
        const result = AppDataSchema.safeParse(parsed)
        if (!result.success) {
          setImportMessage({ type: 'error', text: '檔案格式不符，匯入失敗。' })
          return
        }
        importData(result.data)
        setImportMessage({ type: 'success', text: '匯入成功。' })
      })
      .catch(() => {
        setImportMessage({ type: 'error', text: '無法讀取檔案，請確認是有效的 JSON。' })
      })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">備份資料</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          匯出成 JSON 檔案保存，或匯入之前備份的檔案（會覆蓋目前所有資料）。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleExport} className={buttonClass}>
            匯出 JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={buttonClass}
          >
            匯入 JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportFile(file)
              e.target.value = ''
            }}
          />
        </div>
        {importMessage && (
          <p
            className={`mt-2 text-xs ${
              importMessage.type === 'success'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {importMessage.text}
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">清除資料</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          會清除所有試算假設、進度紀錄與市場評估，且無法復原，建議先匯出備份。
        </p>
        <div className="mt-3">
          {pendingReset ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  resetAllData()
                  setPendingReset(false)
                }}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                確定清除所有資料
              </button>
              <button
                type="button"
                onClick={() => setPendingReset(false)}
                className={buttonClass}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPendingReset(true)}
              className={buttonClass}
            >
              清除所有資料
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
