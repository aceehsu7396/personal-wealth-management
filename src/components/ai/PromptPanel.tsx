import { useState } from 'react'
import { secondaryButton, textLink } from '../ui'

// "AI 說明" without an API key (stage 6): shows the prompt the rules
// produced, copies it, and links to claude.ai for the trader to paste.
export function PromptPanel({ label = 'AI 說明', build, amounts = false }: { label?: string; build: (includeAmounts: boolean) => string; amounts?: boolean }) {
  const [open, setOpen] = useState(false)
  const [withAmounts, setWithAmounts] = useState(false)
  const [copied, setCopied] = useState(false)
  const prompt = open ? build(withAmounts) : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="print:hidden">
      <button type="button" className={textLink} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? `收起${label}` : `${label}（複製到 Claude）`}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            不需要 API 金鑰：複製下面的提示詞，貼到你自己的 Claude 對話。AI 只負責說明規則算出的結果，決定仍以規則與你自己為準。
          </p>
          <textarea readOnly aria-label="提示詞" className="h-48 w-full rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200" value={prompt} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={secondaryButton} onClick={() => void copy()}>
              {copied ? '已複製' : '複製提示詞'}
            </button>
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className={textLink}>
              打開 claude.ai
            </a>
            {amounts && (
              <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={withAmounts} onChange={(e) => setWithAmounts(e.target.checked)} />
                包含新台幣金額（預設隱藏）
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
