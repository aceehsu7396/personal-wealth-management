import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'

const STORAGE_KEY = 'pfm:simGuideCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Getting-started steps shown on every simulation tab: where to find
// candidates, which strategy to try, and the two gates before real money.
export function SimGuide() {
  const watchlist = useAppStore((s) => s.watchlist)
  const { journey } = useJourney()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const done = (id: string) => journey.stages[3].steps.find((s) => s.id === id)?.done ?? false

  const steps = [
    {
      title: '找標的',
      detail: '用選股篩選器找候選，加入觀察名單',
      done: watchlist.length > 0 || done('4.1'),
      to: '/sim/screener',
    },
    { title: '選策略', detail: '套用範本庫，或自己寫策略卡', done: done('4.1'), to: '/sim/strategies' },
    { title: '回測通過', detail: '樣本外勝過買進持有，看懂解讀', done: done('4.2'), to: '/sim/backtest' },
    { title: '虛擬交易', detail: '照規則操作 3 個月、10 筆', done: done('4.3'), to: '/sim/paper' },
  ]
  const next = steps.find((s) => !s.done)

  function toggle() {
    const value = !collapsed
    setCollapsed(value)
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      // The guide still works without remembering its state.
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
          新手起步：{steps.filter((s) => s.done).length}/4
          {next && (
            <>
              ，下一步{' '}
              {next.to === pathname ? (
                <span>就在這頁：{next.title}</span>
              ) : (
                <Link to={next.to} className="underline">
                  {next.title}
                </Link>
              )}
            </>
          )}
          {!next && '，可以開始小額實單（行動路線階段五）'}
        </p>
        <button type="button" onClick={toggle} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
          {collapsed ? '展開' : '收合'}
        </button>
      </div>
      {!collapsed && (
        <>
          <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Link
                  to={s.to}
                  className={`block rounded-md border px-3 py-2 text-xs ${
                    s.to === pathname
                      ? 'border-indigo-500 bg-white dark:bg-gray-800'
                      : 'border-transparent bg-white/70 hover:border-indigo-300 dark:bg-gray-800/70'
                  }`}
                >
                  <span className={`font-semibold ${s.done ? 'text-indigo-700 dark:text-indigo-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {s.done ? '✓' : `${i + 1}.`} {s.title}
                  </span>
                  <span className="mt-0.5 block text-gray-500 dark:text-gray-400">{s.detail}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            完整流程與名詞說明見手冊{' '}
            <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              10 §9 從篩選到下單
            </Link>{' '}
            與{' '}
            <Link to="/handbook/附錄B" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              附錄B 名詞解釋
            </Link>
            。
          </p>
        </>
      )}
    </div>
  )
}
