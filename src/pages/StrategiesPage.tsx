import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { cardFromTemplate, restoreBuiltIns, useLibrary } from '../lib/backtest/library'
import { SimGuide } from '../components/SimGuide'
import { StrategyResearchLinks } from '../components/research/StrategyResearchLinks'
import { useAppStore } from '../lib/storage/appStore'
import { STRATEGY_STATUS_LABELS, STRATEGY_TEMPLATES, formatSymbol, parseSymbolList, resolveParams } from '../lib/backtest/templates'
import { liveGate, PAPER_RULES } from '../lib/calculations/strategyProgress'
import { todayIsoDate } from '../lib/market/twse'
import { StrategyForm, type StrategyFormValues, type TemplateFormValues } from '../components/forms/StrategyForm'
import { StrategyTemplateSchema, type LibraryTemplate, type StrategyStatus } from '../lib/storage/schema'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

const STATUS_STYLE: Record<StrategyStatus, string> = {
  dev: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  paper: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  live: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  retired: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
}

export function StrategiesPage() {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const runs = useAppStore((s) => s.backtestRuns)
  const accounts = useAppStore((s) => s.paperAccounts)
  const policy = useAppStore((s) => s.investmentPolicy)
  const addTradingStrategy = useAppStore((s) => s.addTradingStrategy)
  const updateTradingStrategy = useAppStore((s) => s.updateTradingStrategy)
  const removeTradingStrategy = useAppStore((s) => s.removeTradingStrategy)

  // null = form closed, 'new' = creating, otherwise the id being edited
  const navigate = useNavigate()
  // From a research card: ?new=discretionary (or ma_cross)&symbols=TW:2317&name=…
  const [search, setSearch] = useSearchParams()
  const newTemplate = StrategyTemplateSchema.safeParse(search.get('new'))
  const [draft] = useState<Partial<StrategyFormValues> | undefined>(() =>
    newTemplate.success
      ? {
          template: newTemplate.data,
          name: search.get('name') ?? '',
          symbols: parseSymbolList(search.get('symbols') ?? ''),
          // Opened from a research card: the card judged the company.
          edge:
            newTemplate.data === 'discretionary'
              ? '基本面錯價：研究卡判斷公司品質與合理價，只在價格低於合理價時分批買進'
              : newTemplate.data === 'ma_cross' && search.get('symbols')
                ? '研究卡選出的好公司，用均線趨勢決定進出，避開長期下跌段'
                : undefined,
          entryRules:
            newTemplate.data === 'discretionary'
              ? '研究卡結論為「值得投資」、現價進入買進區時，依進出場建議分 3 批建倉（每批受每筆風險限制）'
              : undefined,
          exitRules:
            newTemplate.data === 'discretionary' ? '研究卡建議減碼或出清、論點失效，或觸及建議停損' : undefined,
        }
      : undefined,
  )
  const [editing, setEditing] = useState<string | null>(draft ? 'new' : null)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [libEditing, setLibEditing] = useState<string | null>(null)
  const [pendingLibDelete, setPendingLibDelete] = useState<string | null>(null)
  const { library, save: saveLibrary } = useLibrary()
  const inCompare = library.filter((t) => t.inCompare).length
  const missingBuiltIns = restoreBuiltIns(library).length - library.length
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const today = todayIsoDate()
  const editingStrategy = editing && editing !== 'new' ? strategies.find((s) => s.id === editing) : undefined

  function applyTemplate(t: LibraryTemplate, thenCompare: boolean) {
    const id = addTradingStrategy(cardFromTemplate(t, t.symbols, Math.min(policy.riskPerTradePercent, 1)))
    if (thenCompare) navigate(`/sim/compare?strategy=${id}`)
  }

  function saveTemplate(values: TemplateFormValues) {
    if (libEditing && libEditing !== 'new') saveLibrary(library.map((t) => (t.id === libEditing ? { ...t, ...values } : t)))
    else saveLibrary([...library, { ...values, id: crypto.randomUUID() }])
    setLibEditing(null)
  }

  function handleSubmit(values: StrategyFormValues) {
    if (editingStrategy) updateTradingStrategy(editingStrategy.id, values)
    else addTradingStrategy({ ...values, status: 'dev' })
    setEditing(null)
    if (draft) setSearch({}, { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">範本庫與策略卡</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        範本庫存放寫好的策略範本，由你新增、修改、決定哪些納入策略比較；套用到個股就成為策略卡：優勢、進出場規則、每筆風險。流程是「開發中 → 回測通過 → 虛擬交易 {PAPER_RULES.months} 個月、
        {PAPER_RULES.fills} 筆 → 實單」，兩關都過才能改成實單。說明見手冊{' '}
        <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          10 交易策略開發與回測
        </Link>
        。
      </p>

      <SimGuide />

      <div className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">範本庫（{library.length}）</h2>
          <div className="flex flex-wrap items-center gap-3">
            {missingBuiltIns > 0 && (
              <button type="button" onClick={() => saveLibrary(restoreBuiltIns(library))} className={linkClass}>
                還原 {missingBuiltIns} 個內建範本
              </button>
            )}
            <button type="button" onClick={() => setLibEditing('new')} className={linkClass}>
              ＋ 新增範本
            </button>
            <button type="button" onClick={() => setLibraryOpen((v) => !v)} className={linkClass}>
              {libraryOpen ? '收合' : '展開'}
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          寫好優勢與進出場規則的策略範本，由你維護。勾「納入比較」的範本會在
          <Link to="/sim/compare" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
            策略比較
          </Link>
          一起回測（{inCompare} 個）；套用後成為你的策略卡（開發中）。建議第一次從「0050 均線趨勢」開始。
        </p>
        {libEditing && (
          <div className="mt-4 rounded-md border border-indigo-200 p-4 dark:border-indigo-800">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{libEditing === 'new' ? '新增範本' : '編輯範本'}</h3>
            <StrategyForm
              key={libEditing}
              libraryEntry={libEditing === 'new' ? 'new' : library.find((t) => t.id === libEditing)}
              defaultRiskPercent={policy.riskPerTradePercent}
              onSubmit={() => undefined}
              onSubmitTemplate={saveTemplate}
              onCancel={() => setLibEditing(null)}
            />
          </div>
        )}
        {libraryOpen && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {library.map((t) => {
              const def = STRATEGY_TEMPLATES[t.template]
              const applied = strategies.some((s) => s.name === t.name)
              return (
                <div key={t.id} className="flex flex-col rounded-md border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{t.name}</p>
                    {def.backtestable && (
                      <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={t.inCompare} onChange={() => saveLibrary(library.map((x) => (x.id === t.id ? { ...x, inCompare: !x.inCompare } : x)))} />
                        納入比較{t.role === 'benchmark' && '（基準）'}
                      </label>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {def.label}（{def.origin}）{t.symbols.length > 0 ? `・${t.symbols.map(formatSymbol).join('、')}` : '・標的不限'}
                  </p>
                  {def.params.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{def.params.map((x) => `${x.label} ${resolveParams(t.template, t.params)[x.key]}`).join('｜')}</p>
                  )}
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{t.edge}</p>
                  {t.suits && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">適合：{t.suits}</p>}
                  {t.risk && <p className="text-xs text-orange-700 dark:text-orange-400">風險：{t.risk}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
                    {t.symbols.length > 0 || !def.backtestable ? (
                      <>
                        {def.backtestable && (
                          <button
                            type="button"
                            onClick={() => applyTemplate(t, true)}
                            className="rounded-md border border-indigo-600 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
                          >
                            套用並比較
                          </button>
                        )}
                        <button type="button" onClick={() => applyTemplate(t, false)} className={linkClass}>
                          {applied ? '再套用一份' : '套用'}
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">在策略比較輸入標的後，從結果「建立策略卡」</span>
                    )}
                    <button type="button" onClick={() => setLibEditing(t.id)} className={linkClass}>
                      編輯
                    </button>
                    {pendingLibDelete === t.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            saveLibrary(library.filter((x) => x.id !== t.id))
                            setPendingLibDelete(null)
                          }}
                          className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                        >
                          確定刪除
                        </button>
                        <button type="button" onClick={() => setPendingLibDelete(null)} className="text-xs text-gray-500 hover:underline">
                          取消
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setPendingLibDelete(t.id)} className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400">
                        刪除
                      </button>
                    )}
                    {!def.backtestable && <span className="text-xs text-gray-500">無法自動回測，套用後直接用虛擬帳戶練習</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <h2 className="mt-10 text-lg font-semibold text-gray-900 dark:text-gray-100">我的策略卡（{strategies.length}）</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">套用範本或從策略比較建立的個股策略：開發中 → 回測通過 → 虛擬交易 → 實單。</p>

      {editing ? (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingStrategy ? `編輯策略卡：${editingStrategy.name}` : '新增策略卡'}
          </h2>
          <div className="mt-4">
            <StrategyForm
              key={editing}
              initial={editingStrategy}
              draft={editing === 'new' ? draft : undefined}
              defaultRiskPercent={policy.riskPerTradePercent}
              onSubmit={handleSubmit}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          新增策略卡
        </button>
      )}

      <div className="mt-6 space-y-4">
        {strategies.map((s) => {
          const def = STRATEGY_TEMPLATES[s.template]
          const gate = liveGate(s, runs, accounts, today)
          const params = resolveParams(s.template, s.params)
          const ownRuns = runs.filter((r) => r.strategyId === s.id).length
          const ownAccounts = accounts.filter((a) => a.strategyId === s.id).length
          return (
            <div key={s.id} className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{s.name}</h3>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>
                  {STRATEGY_STATUS_LABELS[s.status]}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {def.label}・{s.symbols.map(formatSymbol).join('、') || '未設定標的'}・每筆風險 {s.riskPerTradePercent}%
                </span>
              </div>
              {def.params.length > 0 && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {def.params.map((x) => `${x.label} ${params[x.key]}`).join('｜')}
                </p>
              )}
              <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                {[
                  ['優勢', s.edge],
                  ['進場', s.entryRules],
                  ['出場', s.exitRules],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{k}</dt>
                    <dd className="whitespace-pre-line text-gray-700 dark:text-gray-300">{v || '—'}</dd>
                  </div>
                ))}
              </dl>
              <StrategyResearchLinks strategy={s} />

              <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                {gate.backtestPassed ? '✓' : '☐'} 回測樣本外勝過買進持有（報酬或風險調整後；{ownRuns} 次回測）
                {gate.paperProven ? '✓' : '☐'} 虛擬交易 {PAPER_RULES.months} 個月、{PAPER_RULES.fills} 筆（{ownAccounts} 個帳戶）
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {(() => {
                  // The one step this card needs next.
                  // Outlined: the page's one solid button is 「新增策略卡」 (docs/ui-guidelines.md §2).
                  const btn = 'rounded-md border border-indigo-600 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-900/30'
                  if (s.status === 'retired') return null
                  if (s.status === 'live') {
                    // Real-money entries start from a trade plan.
                    return (
                      <Link to={`/portfolio/plans?strategy=${encodeURIComponent(s.id)}`} className={btn}>
                        下一步：建立計畫單 →
                      </Link>
                    )
                  }
                  if (def.backtestable && !gate.backtestPassed)
                    return (
                      <Link to={`/sim/backtest?strategy=${s.id}`} className={btn}>
                        下一步：回測 →
                      </Link>
                    )
                  if (!gate.paperProven)
                    return (
                      <Link to={`/sim/paper?strategy=${s.id}`} className={btn}>
                        下一步：虛擬交易 →
                      </Link>
                    )
                  if (!gate.allowed) return null
                  return (
                    <button type="button" onClick={() => updateTradingStrategy(s.id, { status: 'live' })} className={btn}>
                      下一步：改為實單
                    </button>
                  )
                })()}
                {def.backtestable && (
                  <Link to={`/sim/backtest?strategy=${s.id}`} className={linkClass}>
                    回測
                  </Link>
                )}
                <Link to={`/sim/paper?strategy=${s.id}`} className={linkClass}>
                  虛擬帳戶
                </Link>
                <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                  狀態
                  <select
                    className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
                    value={s.status}
                    onChange={(e) => updateTradingStrategy(s.id, { status: e.target.value as StrategyStatus })}
                  >
                    {(Object.keys(STRATEGY_STATUS_LABELS) as StrategyStatus[]).map((st) => (
                      <option key={st} value={st} disabled={st === 'live' && !gate.allowed && s.status !== 'live'}>
                        {STRATEGY_STATUS_LABELS[st]}
                        {st === 'live' && !gate.allowed ? '（需通過回測與虛擬交易）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setEditing(s.id)} className={linkClass}>
                  編輯
                </button>
                {pendingDeleteId === s.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        removeTradingStrategy(s.id)
                        setPendingDeleteId(null)
                      }}
                      className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                    >
                      確定刪除
                    </button>
                    <button type="button" onClick={() => setPendingDeleteId(null)} className="text-xs text-gray-500 hover:underline">
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(s.id)}
                    className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                  >
                    刪除
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
