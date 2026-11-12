import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSyncContext } from '../../lib/sync/syncContext'
import { MIN_PASSPHRASE } from '../../lib/sync/crypto'
import { disablePush, enablePush, pushEnabled, pushSupported, testPush } from '../../lib/push/push'
import { Field, inputClass } from '../forms/FormField'
import { Badge, Card, secondaryButton, textLink } from '../ui'

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—')

// Settings for end-to-end encrypted sync and payload-free push (stage 6).
export function SyncCard() {
  const sync = useSyncContext()
  const [url, setUrl] = useState(sync.settings.url ?? '')
  const [pass, setPass] = useState('')
  const [rememberDevice, setRememberDevice] = useState(true)
  const [push, setPush] = useState<boolean | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const st = sync.status

  useEffect(() => {
    void pushEnabled().then(setPush)
  }, [])

  const togglePush = async () => {
    setPushMsg(null)
    const token = await sync.token()
    if (!token || !sync.settings.url) return setPushMsg('先在上方設定同步，推播用同一把密語驗證。')
    try {
      if (push) await disablePush(sync.settings.url, token)
      else await enablePush(sync.settings.url, token)
      setPush(!push)
      setPushMsg(push ? '已關閉推播。' : '已開啟：每個交易日 15:30 左右提醒你看今天要處理的事。')
    } catch (e) {
      setPushMsg((e as Error).message)
    }
  }

  const unlocked = st.kind !== 'off' && st.kind !== 'locked' && st.kind !== 'confirmNew' && sync.settings.vaultId
  return (
    <Card
      title="同步與推播"
      description="在多台裝置間同步你的資料，並在收盤後推播提醒。資料在這台瀏覽器先用你的密語加密才上傳，伺服器看不到內容；推播不帶任何個人資料。需要先部署自己的 Cloudflare Worker（免費方案）。"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {st.kind === 'off' && '尚未設定。'}
          {st.kind === 'locked' && '已設定伺服器，請輸入密語解鎖。'}
          {st.kind === 'idle' && <>已同步，上次 {when(st.at)}。</>}
          {st.kind === 'busy' && st.message}
          {st.kind === 'error' && <span className="text-red-700 dark:text-red-400">{st.message}</span>}
          {st.kind === 'conflict' && <span className="text-amber-800 dark:text-amber-300">這台裝置和雲端都有新的修改（雲端版本 {st.remote.version}，{when(st.remote.updatedAt)}）。要保留哪一份？</span>}{' '}
          <Link to="/handbook/04" className={textLink}>
            說明
          </Link>
        </p>
        {st.kind === 'confirmNew' && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
            <p>雲端還沒有這把密語的資料。如果你已經在別台裝置設定過同步，代表密語打錯了，請登出後重新輸入。</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <button type="button" className={secondaryButton} onClick={() => void sync.resolve('create')}>
                這是第一台裝置：建立雲端保險箱
              </button>
              <button type="button" className="text-sm hover:underline" onClick={sync.forget}>
                密語打錯了，重新輸入
              </button>
            </div>
          </div>
        )}
        {st.kind === 'conflict' && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondaryButton} onClick={() => void sync.resolve('remote')}>
              用雲端版本（覆蓋這台）
            </button>
            <button type="button" className={secondaryButton} onClick={() => void sync.resolve('local')}>
              用這台的版本（覆蓋雲端）
            </button>
          </div>
        )}

        {!unlocked ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Worker 網址">
              <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://pfm-sync.你的帳號.workers.dev" />
            </Field>
            <Field label={`密語（至少 ${MIN_PASSPHRASE} 個字，所有裝置相同）`}>
              <input type="password" autoComplete="new-password" className={inputClass} value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 sm:col-span-2">
              <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
              記住這台裝置（只存推導出的金鑰，不存密語；公用電腦請不要勾）
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">忘記密語就無法解開雲端的資料，也沒有人能幫你找回；請另外記在安全的地方。</p>
            <div className="sm:col-span-2">
              <button type="button" className={secondaryButton} disabled={!url.trim() || pass.length < MIN_PASSPHRASE || st.kind === 'busy'} onClick={() => void sync.unlock(url, pass, rememberDevice).then(() => setPass(''))}>
                連線並同步
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={secondaryButton} disabled={st.kind === 'busy'} onClick={() => void sync.syncNow()}>
              立即同步
            </button>
            <button type="button" className="text-sm text-gray-600 hover:underline dark:text-gray-400" onClick={sync.forget}>
              在這台裝置登出
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-400">保險箱 {sync.settings.vaultId?.slice(0, 8)}…・資料變動 2 分鐘後自動上傳</span>
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">收盤後推播</span>
            {push ? <Badge tone="good">已開啟</Badge> : <Badge tone="info">未開啟</Badge>}
            <button type="button" className={secondaryButton} disabled={!unlocked || !pushSupported()} onClick={() => void togglePush()}>
              {push ? '關閉推播' : '開啟推播'}
            </button>
            {push && (
              <button
                type="button"
                className={textLink}
                onClick={() =>
                  void sync.token().then((t) =>
                    t && sync.settings.url ? testPush(sync.settings.url, t).then((n) => setPushMsg(`已送出 ${n} 則測試推播。`), (e: Error) => setPushMsg(e.message)) : undefined,
                  )
                }
              >
                送一則測試
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {pushSupported() ? '通知內容由這台裝置自己計算：今天要處理幾件事，加上局勢與全市場事件。' : '這個瀏覽器不支援推播。iPhone 要先用 Safari 把網站「加入主畫面」，再從主畫面打開。'}
          </p>
          {pushMsg && <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{pushMsg}</p>}
        </div>
      </div>
    </Card>
  )
}
