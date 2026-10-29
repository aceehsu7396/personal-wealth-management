import { useEffect, useState } from 'react'
import { fetchFundNavs, fundCurrency, searchFunds, type FundNav } from '../../lib/market/fundNav'
import { inputClass, labelClass } from './FormField'

// Finds a fund in the daily NAV snapshot by name or code; picking one fills
// the code, name, currency and latest NAV so later refreshes find it.
export function FundSearch({ onPick }: { onPick: (fund: FundNav) => void }) {
  const [funds, setFunds] = useState<FundNav[] | null | undefined>(undefined)
  const [query, setQuery] = useState('')
  useEffect(() => {
    void fetchFundNavs().then(setFunds)
  }, [])
  const matches = funds ? searchFunds(query, funds) : []

  return (
    <div className="sm:col-span-3">
      <label className="block">
        <span className={labelClass}>搜尋基金（輸入名稱關鍵字或代碼，選取後自動帶入代碼與最新淨值）</span>
        <input
          type="search"
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如：安聯 收益成長、A04008"
        />
      </label>
      {funds === null && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">今天的基金淨值資料還沒準備好，請手動輸入。</p>}
      {matches.length > 0 && (
        <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
          {matches.map((f) => {
            const ok = fundCurrency(f.currency) !== null
            return (
              <li key={f.code}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(f)
                    setQuery('')
                  }}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {f.name} <span className="text-xs text-gray-500 dark:text-gray-400">{f.code}</span>
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {f.currency} {f.nav}（{f.date}）{!ok && '・需手動換算成台幣或美元'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
