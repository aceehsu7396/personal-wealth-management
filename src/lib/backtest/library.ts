import { useMemo } from 'react'
import type { CompareEntry, LibraryTemplate, TradingStrategy } from '../storage/schema'
import { useAppStore } from '../storage/appStore'
import { STARTER_STRATEGIES } from './starterStrategies'
import { DEFAULT_COMPARE_SET } from './compare'
import { STRATEGY_TEMPLATES, defaultParams, resolveParams } from './templates'
import { WEEKLY_TEMPLATES } from './weekly'

// The template library (handbook 10 §6.5): the starter strategies and the
// comparison set in one list the trader maintains. A comparison runs the
// entries ticked 「納入比較」; applying one makes a strategy card.

const roleOf = (t: LibraryTemplate['template']): LibraryTemplate['role'] => (t === 'buy_hold' || t === 'dca' ? 'benchmark' : 'signal')
const sameParams = (a: CompareEntry | LibraryTemplate, b: CompareEntry | LibraryTemplate) =>
  a.template === b.template &&
  (a.cadence ?? 'daily') === (b.cadence ?? 'daily') &&
  JSON.stringify(resolveParams(a.template, a.params)) === JSON.stringify(resolveParams(b.template, b.params))

function fromEntry(e: CompareEntry, builtIn?: string): LibraryTemplate {
  const def = STRATEGY_TEMPLATES[e.template]
  return {
    id: e.key,
    name: e.label,
    template: e.template,
    params: e.params,
    symbols: [],
    edge: def.summary,
    entryRules: def.entry,
    exitRules: def.exit,
    suits: '',
    risk: '',
    notes: '',
    role: e.role,
    inCompare: true,
    builtIn,
    ...(e.cadence ? { cadence: e.cadence } : {}),
  }
}

// The weekly templates (handbook 10 §6.6), in comparisons by default.
const WEEKLY_SUITS: Record<string, { suits: string; risk: string }> = {
  weekly_ma: { suits: '趨勢明確的權值股與市值型 ETF；一週看一次就好的人。', risk: '盤整期會來回停損；週中大跌只靠停損單保護。' },
  weekly_breakout: { suits: '有題材、波動較大的個股；中短期波段 2～8 週。', risk: '勝率低（常 30～40%），要能承受連續幾次小賠。' },
  weekly_rotation: { suits: '3～6 檔相關性低的 ETF 或權值股，每週換到最強的。', risk: '換手多，成本與證交稅吃報酬；一定要用實際折扣回測。' },
  weekly_pullback: { suits: '長期多頭中的龍頭股，等短暫回檔再買。', risk: '趨勢反轉時，回檔會變成下跌，靠停損與持有上限出場。' },
}
export const WEEKLY_COMPARE_SET: CompareEntry[] = WEEKLY_TEMPLATES.map((t) => ({
  key: t,
  label: STRATEGY_TEMPLATES[t].label,
  template: t,
  params: defaultParams(t),
  role: 'signal',
  cadence: 'weekly',
}))

// The built-in library. A starter matching a comparison entry takes the
// entry's key as id, so earlier comparisons still line up row by row.
export function builtInLibrary(): LibraryTemplate[] {
  const out: LibraryTemplate[] = STARTER_STRATEGIES.map(({ id, card: { riskPerTradePercent: _risk, ...card }, suits, risk }) => ({
    ...card,
    id,
    suits,
    risk,
    role: roleOf(card.template),
    inCompare: false,
    builtIn: id,
  }))
  for (const e of DEFAULT_COMPARE_SET) {
    const match = out.find((t) => !t.inCompare && sameParams(t, e))
    if (match) Object.assign(match, { id: e.key, inCompare: true })
    else out.push(fromEntry(e, `compare:${e.key}`))
  }
  for (const e of WEEKLY_COMPARE_SET) out.push({ ...fromEntry(e, `weekly:${e.key}`), ...WEEKLY_SUITS[e.key] })
  // Rotation joins comparisons of two or more symbols.
  for (const t of out) if (STRATEGY_TEMPLATES[t.template].multiSymbol) t.inCompare = true
  return out
}

// The library before the trader first changes it: built in, with a saved
// comparison set (from before the library) ticked in place of the default.
export function defaultLibrary(compareSet?: CompareEntry[]): LibraryTemplate[] {
  const lib = builtInLibrary()
  if (!compareSet) return lib
  for (const t of lib) t.inCompare = false
  for (const e of compareSet) {
    const match = lib.find((t) => t.id === e.key) ?? lib.find((t) => sameParams(t, e))
    if (match) match.inCompare = true
    else lib.push({ ...fromEntry(e), builtIn: undefined })
  }
  return lib
}

// Built-in entries missing from the library, appended; edits are kept.
export function restoreBuiltIns(library: LibraryTemplate[]): LibraryTemplate[] {
  const have = new Set(library.map((t) => t.builtIn).filter(Boolean))
  return [...library, ...builtInLibrary().filter((t) => !have.has(t.builtIn) && !library.some((x) => x.id === t.id))]
}

// Ticked entries a comparison on this many symbols can run: rotation needs
// two or more, written plans cannot be tested.
export function compareEntriesOf(library: LibraryTemplate[], symbolCount: number): CompareEntry[] {
  return library
    .filter((t) => t.inCompare && STRATEGY_TEMPLATES[t.template].backtestable && (!STRATEGY_TEMPLATES[t.template].multiSymbol || symbolCount >= 2))
    .map((t) => ({ key: t.id, label: t.name, template: t.template, params: resolveParams(t.template, t.params), role: t.role, ...(t.cadence ? { cadence: t.cadence } : {}) }))
}

// A strategy card from a library entry (status 開發中).
export function cardFromTemplate(t: LibraryTemplate, symbols: string[], riskPercent: number): Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: t.symbols.length === 0 && symbols.length > 0 ? `${t.name}・${symbols.map((s) => s.replace(/^TW:/, '')).join('、')}` : t.name,
    template: t.template,
    params: t.params,
    symbols: t.symbols.length > 0 ? t.symbols : symbols,
    edge: t.edge,
    entryRules: t.entryRules,
    exitRules: t.exitRules,
    riskPerTradePercent: riskPercent,
    status: 'dev',
    notes: t.notes,
    ...(t.cadence ? { cadence: t.cadence } : {}),
  }
}

export function useLibrary(): { library: LibraryTemplate[]; save: (library: LibraryTemplate[]) => void } {
  const stored = useAppStore((s) => s.strategyLibrary)
  const compareSet = useAppStore((s) => s.compareSet)
  const save = useAppStore((s) => s.setStrategyLibrary)
  const library = useMemo(() => stored ?? defaultLibrary(compareSet), [stored, compareSet])
  return { library, save }
}

// A comparison's adjusted set saved into the library: ticked entries keep
// their new parameters, unticked ones leave the comparison, new ones join.
export function withCompareSet(library: LibraryTemplate[], entries: CompareEntry[], off: string[]): LibraryTemplate[] {
  const byKey = new Map(entries.map((e) => [e.key, e]))
  const updated = library.map((t) => {
    const e = byKey.get(t.id)
    return e ? { ...t, params: e.params, inCompare: !off.includes(e.key) } : t
  })
  const added = entries.filter((e) => !library.some((t) => t.id === e.key) && !off.includes(e.key)).map((e) => fromEntry(e))
  return [...updated, ...added]
}
