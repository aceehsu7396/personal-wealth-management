import type { ParamHelp as ParamHelpText, SettingHelp } from '../lib/backtest/templates'

// "怎麼選？" under a strategy or backtest setting: what it means, what
// raising or lowering it trades off, common values and the usual trap.
export function ParamHelp({ help, range }: { help: ParamHelpText | SettingHelp; range?: { min: number; max: number; default: number } }) {
  const rows: [string, string][] =
    'higher' in help
      ? [
          ['意義', help.meaning],
          ['調高', help.higher],
          ['調低', help.lower],
          ['常見設定', help.typical],
          ['陷阱', help.pitfall],
        ]
      : [
          ['意義', help.meaning],
          ['怎麼選', help.howToChoose],
          ['陷阱', help.pitfall],
        ]
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-medium text-indigo-700 hover:underline dark:text-indigo-400">
        怎麼選？{range && <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">（範圍 {range.min}～{range.max}，預設 {range.default}）</span>}
      </summary>
      <dl className="mt-1 space-y-1 rounded-md bg-gray-50 p-2 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="inline font-semibold text-gray-900 dark:text-gray-100">{k}：</dt>
            <dd className="inline">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
