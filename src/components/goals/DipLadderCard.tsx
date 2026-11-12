import { useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { useRegime } from '../../lib/market/useRegime'
import { dipLadderStatus } from '../../lib/market/dipLadder'
import { fullTimeTarget } from '../../lib/calculations/traderReadiness'
import { todayIsoDate } from '../../lib/market/twse'
import { inputClass } from '../forms/FormField'
import { Badge, Card, secondaryButton, textLink } from '../ui'

const thClass = 'py-2 pr-4 text-left text-xs font-medium text-gray-600 dark:text-gray-400'
const tdClass = 'py-2 pr-4 text-sm text-gray-800 dark:text-gray-200'
const twd = (v: number) => `NT$${v.toLocaleString('zh-TW')}`

// The dip ladder (blueprint 02 §4.2): reserve cash for each TAIEX drawdown
// step, written down and signed before the fall.
export function DipLadderCard() {
  const ladder = useAppStore((s) => s.dipLadder)
  const sign = useAppStore((s) => s.signDipLadder)
  const mark = useAppStore((s) => s.markDipStep)
  const assumptions = useAppStore((s) => s.assumptions)
  const foundation = useAppStore((s) => s.foundation)
  const { drawdown, lastHigh } = useRegime()
  const [amounts, setAmounts] = useState<string[] | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const buffer = { amount: foundation.emergencyFundAmount, target: fullTimeTarget(assumptions, foundation).bufferTarget }
  const status = dipLadderStatus(ladder, drawdown, lastHigh, buffer)
  const submit = () => {
    if (!amounts) return
    const values = amounts.map(Number)
    if (values.some((v) => !(v >= 0))) return setError('金額要是 0 以上的數字。')
    if (!reason.trim()) return setError('請寫下理由。')
    sign(
      ladder.steps.map((s, i) => ({ ...s, amountTwd: values[i] })),
      reason.trim(),
    )
    setAmounts(null)
    setReason('')
    setError(null)
  }

  return (
    <Card
      title="大盤逢低階梯"
      description="加權指數從 52 週高點回檔到各階時，投入事先預留的資金。生活費緩衝不足時先補緩衝；指數創新高後重新計算。"
      className="mt-8"
      action={
        amounts ? undefined : (
          <button type="button" className={secondaryButton} onClick={() => setAmounts(ladder.steps.map((s) => String(s.amountTwd)))}>
            編輯
          </button>
        )
      }
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {drawdown === null ? '加權指數資料讀取中。' : `加權指數距 52 週高點 ${drawdown}%${lastHigh ? `（最近高點 ${lastHigh}）` : ''}。`}
        {ladder.signedAt ? `階梯已於 ${ladder.signedAt.slice(0, 10)} 簽署。` : '階梯還沒填金額。'}
        {status.bufferShort && <span className="text-red-700 dark:text-red-400"> 生活費緩衝 {twd(buffer.amount)} 低於目標 {twd(buffer.target)}，先補緩衝。</span>}
      </p>
      <table className="mt-3 w-full max-w-xl">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {['回檔', '投入金額', '狀態'].map((h) => (
              <th key={h} className={thClass}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ladder.steps.map((s, i) => {
            const done = status.done(s)
            const reached = drawdown !== null && drawdown <= s.drawdownPercent
            return (
              <tr key={s.drawdownPercent} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                <td className={tdClass}>{s.drawdownPercent}%</td>
                <td className={`${tdClass} tabular-nums`}>
                  {amounts ? (
                    <input
                      type="number"
                      step="10000"
                      min="0"
                      aria-label={`回檔 ${s.drawdownPercent}% 投入金額`}
                      className={`${inputClass} mt-0 w-36`}
                      value={amounts[i]}
                      onChange={(e) => setAmounts(amounts.map((a, k) => (k === i ? e.target.value : a)))}
                    />
                  ) : s.amountTwd > 0 ? (
                    twd(s.amountTwd)
                  ) : (
                    '—'
                  )}
                </td>
                <td className={tdClass}>
                  {done ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="good">已投入 {s.executedAt}</Badge>
                      <button type="button" className="text-xs text-gray-600 hover:underline dark:text-gray-400" onClick={() => mark(s.drawdownPercent, null)}>
                        復原
                      </button>
                    </span>
                  ) : reached && s.amountTwd > 0 ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="warn">已觸及</Badge>
                      <button type="button" className={textLink} onClick={() => mark(s.drawdownPercent, todayIsoDate())}>
                        記為已投入
                      </button>
                    </span>
                  ) : (
                    <span className="text-gray-600 dark:text-gray-400">未觸及</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {amounts && (
        <div className="mt-4 max-w-xl space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            理由（必填，會留在簽署紀錄）
            <textarea rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="button" className={secondaryButton} onClick={submit}>
              簽署逢低階梯
            </button>
            <button
              type="button"
              className="text-sm text-gray-600 hover:underline dark:text-gray-400"
              onClick={() => {
                setAmounts(null)
                setError(null)
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
