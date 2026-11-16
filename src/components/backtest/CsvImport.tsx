import { useState } from 'react'
import { formatSymbol } from '../../lib/backtest/templates'
import { importCsvSeries, loadSeries } from '../../lib/market/priceHistory'
import { describeAiError } from '../../lib/ai/client'
import { labelClass } from '../forms/FormField'

// US prices come from a Yahoo Finance CSV the trader downloads; TWSE
// prices are fetched (handbook 10 §6).
export function CsvImport({ symbols, onError }: { symbols: string[]; onError: (message: string) => void }) {
  const [version, setVersion] = useState(0)
  const needed = symbols.filter((s) => !s.startsWith('TW:'))
  if (needed.length === 0) return null

  function onFile(symbol: string, file: File | undefined) {
    if (!file) return
    file
      .text()
      .then((text) => {
        importCsvSeries(symbol, text)
        setVersion((v) => v + 1)
      })
      .catch((e) => onError(describeAiError(e)))
  }

  return (
    <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900/40" key={version}>
      <p className={labelClass}>匯入價格（Yahoo Finance 的 Historical Data → Download，CSV 格式）</p>
      <ul className="mt-2 space-y-2">
        {needed.map((s) => {
          const cached = loadSeries(s)
          return (
            <li key={s} className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-gray-800 dark:text-gray-200">{formatSymbol(s)}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {cached ? `已匯入 ${cached.bars.length} 筆（${cached.bars[0].date}～${cached.bars[cached.bars.length - 1].date}）` : '尚未匯入'}
              </span>
              <input type="file" accept=".csv,text/csv" className="text-xs" onChange={(e) => onFile(s, e.target.files?.[0])} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
