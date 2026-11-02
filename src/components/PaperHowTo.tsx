import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PAPER_RULES } from '../lib/calculations/strategyProgress'

const STORAGE_KEY = 'pfm:paperHowToOpen'

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: '建立帳戶',
    body: (
      <>
        按「＋ 新增帳戶」，填名稱、<strong>連結一張策略卡</strong>（沒連結不計入行動路線 4.3）、市場與初始資金。初始資金建議用你打算真的投入這個策略的金額。連結「開發中」的策略卡時，它會自動改為「虛擬交易」狀態。
      </>
    ),
  },
  {
    title: '每天收盤後（或每週固定一天）做兩件事',
    body: (
      <>
        ① 按「<strong>更新價格</strong>」：用最新收盤價重新計算持倉，並檢查停損與掛單有沒有被觸發。
        <br />② 按「<strong>產生今日策略訊號</strong>」：依策略卡的規則算出今天該買或該賣什麼、幾股、停損放哪裡，按「依訊號下單」就成交。沒有訊號就什麼都不做，這也是紀律。
      </>
    ),
  },
  {
    title: '自己下單時，三種委託的差別',
    body: (
      <>
        <strong>市價</strong>：立刻以最新收盤價成交。
        <br />
        <strong>限價</strong>：之後的交易日價格碰到你設的價格才成交（買進：跌到限價以下；賣出：漲到限價以上）。
        <br />
        <strong>停損單</strong>：只用於賣出，價格跌到觸發價就賣出。
        <br />
        買進時請填<strong>停損價</strong>（必須低於成交價），系統會在之後的交易日自動檢查；持倉表也可以隨時修改停損。手續費與證交稅的算法和回測相同。
      </>
    ),
  },
  {
    title: '每筆都寫理由與情緒',
    body: (
      <>
        理由寫「依哪一條規則」，情緒選 1（極度恐懼）到 5（極度貪婪）。之後回頭看，就知道虧損是規則的問題，還是自己沒照規則（例如貪婪時加碼、恐懼時提早出場）。
      </>
    ),
  },
  {
    title: '怎麼看結果',
    body: (
      <>
        上方四格：帳戶權益、累計報酬與最大回撤、平倉筆數與平均 R（每筆賺賠是停損風險的幾倍），以及 4.3 進度。權益曲線會和 0050 比較；也可以拿來對照策略卡的回測結果，差距大多來自執行。
      </>
    ),
  },
  {
    title: '什麼時候算完成',
    body: (
      <>
        連結策略卡的帳戶從第一筆成交起滿 <strong>{PAPER_RULES.months} 個月、{PAPER_RULES.fills} 筆成交</strong>，就完成行動路線 4.3。回測也通過（4.2）後，策略卡才能改為「實單」。
      </>
    ),
  },
]

// A short how-to at the top of the paper-trading page; collapsible, and
// the choice is remembered on this device.
export function PaperHowTo({ market }: { market?: 'TW' | 'US' }) {
  const [open, setOpen] = useState(readOpen)
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(STORAGE_KEY, open ? '0' : '1')
    } catch {
      // Remembering the choice is optional.
    }
  }
  return (
    <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">虛擬帳戶怎麼用</p>
        <button type="button" onClick={toggle} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          {open ? '收合' : '展開說明'}
        </button>
      </div>
      {open && (
        <>
          <ol className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{s.title}</p>
                  <p className="mt-0.5 leading-6">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {market === 'US' ? '美股帳戶的最新價需要在「最新價」欄位手動輸入。' : '台股帳戶的價格自動取自證交所（上櫃股票目前不支援）。'}
            {' '}原則：照策略卡執行，不臨時改規則；想改規則，回到回測重新驗證。更多說明見手冊{' '}
            <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              10 §7
            </Link>
            。
          </p>
        </>
      )}
    </div>
  )
}
