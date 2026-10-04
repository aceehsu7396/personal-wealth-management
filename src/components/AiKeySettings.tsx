import { useState } from 'react'
import { clearApiKey, getApiKey, setApiKey } from '../lib/ai/apiKeyStorage'
import { inputClass } from './forms/FormField'

export function AiKeySettings() {
  const [value, setValue] = useState(() => getApiKey() ?? '')
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const hasStoredKey = Boolean(getApiKey())

  function handleSave() {
    if (!value.trim()) return
    setApiKey(value.trim())
    setSavedMessage('已儲存。')
  }

  function handleClear() {
    clearApiKey()
    setValue('')
    setSavedMessage('已清除。')
  }

  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Anthropic API 金鑰
        </span>
        <input
          type="password"
          autoComplete="off"
          className={inputClass}
          placeholder="sk-ant-..."
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setSavedMessage(null)
          }}
        />
      </label>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        金鑰僅存在你的瀏覽器本機，<b>不會</b>包含在「資料管理」的 JSON
        匯出/備份中。此金鑰會直接從瀏覽器呼叫 Anthropic
        API，技術上可能被瀏覽器擴充功能或開發者工具讀取，請勿在公用電腦使用。
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          儲存
        </button>
        {hasStoredKey && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            清除金鑰
          </button>
        )}
        {savedMessage && (
          <span className="text-xs text-indigo-600 dark:text-indigo-400">{savedMessage}</span>
        )}
      </div>
    </div>
  )
}
