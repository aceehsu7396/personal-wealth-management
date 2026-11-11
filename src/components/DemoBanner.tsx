import { useState } from 'react'
import { Link } from 'react-router-dom'
import { exitDemo, loadDemo, useDemoActive } from '../lib/demo/demoMode'

// Shown on every page while the worked example (handbook chapter 12) is loaded.
export function DemoBanner() {
  const active = useDemoActive()
  const [busy, setBusy] = useState(false)
  if (!active) return null
  return (
    <div className="border-b border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-orange-900 dark:text-orange-100">
        <span className="font-semibold">示範模式</span>
        <span className="text-xs">目前看到的是手冊 12 章的範例資料，你的資料已另外保存，不受影響。</span>
        <Link to="/handbook/12" className="text-xs font-medium underline">
          對照手冊 12 章
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void exitDemo().finally(() => setBusy(false))
          }}
          className="ml-auto rounded-md bg-orange-700 px-3 py-1 text-xs font-medium text-white hover:bg-orange-800 disabled:opacity-50"
        >
          結束示範，還原我的資料
        </button>
      </div>
    </div>
  )
}

// The settings card that starts (or ends) the demo.
export function DemoControl() {
  const active = useDemoActive()
  const [busy, setBusy] = useState(false)
  const run = (task: () => Promise<void>) => {
    setBusy(true)
    void task().finally(() => setBusy(false))
  }
  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        載入手冊 12 章的完整範例：台積電從選股、研究卡、策略卡、回測、10 個月虛擬交易，到一年實單、交易檢討與每季績效歸因，價格都是真實的歷史資料。
        載入前會先保存你目前的資料，結束示範時原封不動還原；示範期間的任何修改都不會影響你的資料。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {active ? (
          <button type="button" disabled={busy} onClick={() => run(exitDemo)} className="rounded-md bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-50">
            結束示範，還原我的資料
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => run(loadDemo)} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? '載入中…' : '載入示範資料'}
          </button>
        )}
        <Link to="/handbook/12" className="self-center text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          閱讀手冊 12 章
        </Link>
      </div>
    </div>
  )
}
