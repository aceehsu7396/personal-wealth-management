import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { useDataHealth } from '../../lib/data/useDataHealth'
import { STATUS_LABELS, type HealthStatus } from '../../lib/data/freshness'
import { closeDue, routineDue } from '../../lib/paper/autoRoutine'
import { Badge } from '../ui'
import type { Tone } from '../ui/tone'

const TONE: Record<HealthStatus, Tone> = { ok: 'good', warn: 'info', late: 'warn', stale: 'bad', missing: 'bad' }
const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 align-top text-gray-700 dark:text-gray-300'
const STALE_CARD_DAYS = 7

const shortTime = (iso: string) =>
  new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date(iso))

// 設定 → 資料狀態 (handbook 附錄 C §7): the published data, checked after
// every data run and hourly by the watchdog, then what this browser keeps.
export function DataHealthCard() {
  const health = useDataHealth()
  const ranAt = useAppStore((s) => s.paperRoutineRanAt)
  const hasAccounts = useAppStore((s) => s.paperAccounts.length > 0)
  const imported = useAppStore((s) => s.dailyResearchImported)
  const theses = useAppStore((s) => s.stockTheses)
  const now = new Date()
  const oldCards = theses.filter((t) => t.status !== 'exited' && t.market === 'TW' && t.auto && Date.now() - Date.parse(t.auto.fetchedAt) > STALE_CARD_DAYS * 86400000).length

  const local: { label: string; latest: string; status: HealthStatus; note: string }[] = [
    {
      label: '虛擬帳戶收盤更新',
      latest: ranAt ? shortTime(ranAt) : '—',
      status: !hasAccounts ? 'ok' : routineDue(now, ranAt) ? 'late' : 'ok',
      note: !hasAccounts ? '沒有虛擬帳戶' : routineDue(now, ranAt) ? `${closeDue(now)} 的收盤還沒更新：打開任一頁就會自動執行` : '已更新到最近一次收盤',
    },
    {
      label: '每日自動研究匯入',
      latest: imported ?? '—',
      status: 'ok',
      note: '打開網站時自動匯入新的一輪',
    },
    {
      label: '研究卡體檢',
      latest: `${theses.length} 張`,
      status: oldCards > 0 ? 'warn' : 'ok',
      note: oldCards > 0 ? `${oldCards} 張超過 ${STALE_CARD_DAYS} 天沒體檢：打開研究卡頁會在背景依序更新` : '都在 7 天內體檢過',
    },
  ]

  return (
    <div id="data-health" className="mt-8 scroll-mt-24 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">資料狀態</h2>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        每次資料更新後，以及每小時一次，系統會檢查每份資料是否夠新；太舊就自動重跑或改用備用來源，連續修復 12 小時（主動式 ETF 一天）仍失敗才寄信通知。說明見手冊{' '}
        <Link to="/handbook/附錄C" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          附錄 C §7
        </Link>
        。
      </p>
      {!health ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">還沒有檢查結果：下一次資料更新後就會出現。</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            最後檢查 {shortTime(health.checkedAt)}
            {health.dataAt && `・資料最後更新 ${shortTime(health.dataAt)}`}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {['項目', '最新資料', '狀態', '說明'].map((h) => (
                    <th key={h} className={thClass}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {health.items.map((i) => (
                  <tr key={i.key} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                    <td className={`${tdClass} whitespace-nowrap font-medium text-gray-900 dark:text-gray-100`}>{i.label}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>{i.latest ?? '—'}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <Badge tone={TONE[i.status]}>{STATUS_LABELS[i.status]}</Badge>
                    </td>
                    <td className={`${tdClass} text-xs`}>
                      {i.note || '—'}
                      {i.since && <span className="block text-gray-500 dark:text-gray-400">自 {shortTime(i.since)} 起修復中，試過 {i.attempts} 次{i.tried.length > 0 && `（${i.tried.join('、')}）`}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3 className="mt-5 text-sm font-semibold text-gray-900 dark:text-gray-100">這個瀏覽器的資料</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {local.map((l) => (
          <li key={l.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-gray-900 dark:text-gray-100">{l.label}</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{l.latest}</span>
            <Badge tone={TONE[l.status]}>{STATUS_LABELS[l.status]}</Badge>
            <span className="text-xs text-gray-600 dark:text-gray-400">{l.note}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
