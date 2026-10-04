import type { AppData, InvestmentPolicy } from '../storage/schema'
import { computeNetCashFlow } from './netCashFlow'
import { computeRequiredReturn } from './requiredReturn'
import { computeDiscipline } from './disciplineScore'
import { summarizeAttribution } from './attribution'
import { evaluateThesis } from './thesisScoring'
import { isSatellite } from './portfolioRisk'

export type JourneyState = Pick<
  AppData,
  | 'profile'
  | 'assumptions'
  | 'monthlyRecords'
  | 'foundation'
  | 'investmentPolicy'
  | 'holdings'
  | 'trades'
  | 'macroCheckIns'
  | 'stockTheses'
  | 'performanceReviews'
>

export interface JourneyStep {
  id: string
  title: string
  done: boolean
  detail: string
  page: { to: string; label: string }
  handbookSlug: string
}

export interface JourneyStage {
  number: number
  title: string
  summary: string
  steps: JourneyStep[]
  done: boolean
}

export interface JourneyReport {
  stages: JourneyStage[]
  nextStep: JourneyStep | null
  completedCount: number
  totalCount: number
  satelliteUnlocked: boolean
  missingForSatellite: JourneyStep[]
}

export interface StageCriterion {
  label: string
  current: number
  target: number
  met: boolean
}

export interface LearningStage {
  stage: 1 | 2 | 3 | 4
  title: string
  satelliteCapPercent: number
  demoted: boolean
  nextCriteria: StageCriterion[]
}

// Steps that must be done before satellite (individual stock) buys pass the
// pre-trade checklist.
export const SATELLITE_PREREQUISITES = ['1.1', '1.2', '1.4', '2.1', '2.3', '3.1']

export const LEARNING_STAGE_TITLES = ['一 打地基', '二 練研究', '三 建系統', '四 穩定複利'] as const
const STAGE_CAPS = [10, 20, 30, Infinity]
const RECENT_EXPENSE_MONTHS = 3

const PAGES = {
  fire: { to: '/fire', label: '財務自由試算' },
  journey: { to: '/journey', label: '行動路線' },
  strategy: { to: '/strategy', label: '投資策略' },
  portfolio: { to: '/portfolio', label: '投資組合' },
  trades: { to: '/trades', label: '交易日誌' },
  market: { to: '/market', label: '市場檢視' },
  research: { to: '/research', label: '個股研究' },
}

function distinctMonths(dates: string[]): number {
  return new Set(dates.map((d) => d.slice(0, 7))).size
}

// Average spending over the most recent recorded months; falls back to the
// FIRE calculator's monthly expenses when nothing has been recorded.
export function monthlyExpenseBaseline(state: Pick<JourneyState, 'monthlyRecords' | 'assumptions'>): number {
  const recent = [...state.monthlyRecords]
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, RECENT_EXPENSE_MONTHS)
    .map((r) => computeNetCashFlow(r).expenseTotal)
    .filter((v) => v > 0)
  if (recent.length > 0) return recent.reduce((a, v) => a + v, 0) / recent.length
  return state.assumptions.monthlyExpenses
}

export function emergencyFundTarget(state: Pick<JourneyState, 'monthlyRecords' | 'assumptions' | 'foundation'>): number {
  return monthlyExpenseBaseline(state) * state.foundation.emergencyFundTargetMonths
}

function formatTwd(value: number): string {
  return `${Math.round(value).toLocaleString('zh-TW')} 元`
}

export function computeJourney(state: JourneyState): JourneyReport {
  const { assumptions, foundation, investmentPolicy: policy } = state
  const fundTarget = emergencyFundTarget(state)
  const required = computeRequiredReturn(state.profile, assumptions, policy.targetYears)
  const goalSet = assumptions.monthlyExpenses > 0 && assumptions.monthlyIncome > 0
  const heldSleeves = new Set(state.holdings.filter((h) => h.shares > 0).map((h) => h.sleeve))
  const dcaTrades = state.trades.filter((t) => t.reason === 'core_dca')
  const dcaMonths = distinctMonths(dcaTrades.map((t) => t.date))
  const macroMonths = distinctMonths(state.macroCheckIns.map((c) => c.date))
  const sleeveOf = new Map(state.holdings.map((h) => [h.id, h.sleeve]))
  const satelliteBuys = state.trades.filter(
    (t) => t.side === 'buy' && t.holdingId && isSatellite(sleeveOf.get(t.holdingId) ?? 'core_tw'),
  )

  const stages: Omit<JourneyStage, 'done'>[] = [
    {
      number: 1,
      title: '起步：打好財務地基',
      summary: '先確保生活不受市場影響，再決定要承擔多少風險。',
      steps: [
        {
          id: '1.1',
          title: '設定財務自由目標',
          done: goalSet,
          detail: goalSet ? '已填寫每月收入與支出' : '在財務自由試算填寫每月收入與支出',
          page: PAGES.fire,
          handbookSlug: '01',
        },
        {
          id: '1.2',
          title: '準備緊急預備金',
          done: fundTarget > 0 && foundation.emergencyFundAmount >= fundTarget,
          detail:
            fundTarget > 0
              ? `目前 ${formatTwd(foundation.emergencyFundAmount)}，目標 ${formatTwd(fundTarget)}（${foundation.emergencyFundTargetMonths} 個月支出）`
              : '先填寫每月支出，才能算出預備金目標',
          page: PAGES.journey,
          handbookSlug: '01',
        },
        {
          id: '1.3',
          title: '確認所需報酬是否實際',
          done:
            goalSet && required.feasibility !== 'unrealistic' && required.feasibility !== 'unreachable',
          detail:
            required.requiredNominalReturnPercent === null
              ? required.feasibility === 'already_fire'
                ? '已達成目標'
                : '目前條件下無法在目標年限內達成，先調整儲蓄、年限或支出'
              : `${policy.targetYears} 年所需年化報酬 ${required.requiredNominalReturnPercent.toFixed(1)}%`,
          page: PAGES.strategy,
          handbookSlug: '01',
        },
        {
          id: '1.4',
          title: '簽署投資政策聲明',
          done: policy.signedAt !== undefined,
          detail: policy.signedAt ? `已於 ${policy.signedAt} 簽署` : '確認參數後在投資策略頁簽署',
          page: PAGES.strategy,
          handbookSlug: '02',
        },
      ],
    },
    {
      number: 2,
      title: '核心配置：先買下整個市場',
      summary: '用低成本指數 ETF 取得市場報酬，養成定期投入與記錄的習慣。',
      steps: [
        {
          id: '2.1',
          title: '建立核心 ETF 持股',
          done: heldSleeves.has('core_tw') && heldSleeves.has('core_global'),
          detail: '台股大盤與美股/全球 ETF 各至少一檔',
          page: PAGES.portfolio,
          handbookSlug: '03',
        },
        {
          id: '2.2',
          title: '記錄第一筆定期定額',
          done: dcaTrades.length > 0,
          detail: '在交易日誌以「核心定期定額」記錄',
          page: PAGES.trades,
          handbookSlug: '03',
        },
        {
          id: '2.3',
          title: '連續 3 個月執行定期定額',
          done: dcaMonths >= 3,
          detail: `已記錄 ${Math.min(dcaMonths, 3)}/3 個月`,
          page: PAGES.trades,
          handbookSlug: '04',
        },
      ],
    },
    {
      number: 3,
      title: '看懂市場：總經只調比例',
      summary: '每月檢視景氣、流動性與情緒，只用來微調股債比例。',
      steps: [
        {
          id: '3.1',
          title: '完成第一次總經檢視',
          done: macroMonths >= 1,
          detail: '在市場檢視填寫總經三支柱',
          page: PAGES.market,
          handbookSlug: '05',
        },
        {
          id: '3.2',
          title: '連續 3 個月總經檢視',
          done: macroMonths >= 3,
          detail: `已檢視 ${Math.min(macroMonths, 3)}/3 個月`,
          page: PAGES.market,
          handbookSlug: '05',
        },
      ],
    },
    {
      number: 4,
      title: '衛星研究：開始練習選股',
      summary: '在能力圈內研究個股，通過全部檢核才小額建倉。',
      steps: [
        {
          id: '4.1',
          title: '寫第一張觀察用研究卡',
          done: state.stockTheses.length > 0,
          detail: '研究卡隨時可以寫，先觀察不買進',
          page: PAGES.research,
          handbookSlug: '06',
        },
        {
          id: '4.2',
          title: '完成第一筆衛星交易',
          done: satelliteBuys.length > 0,
          detail: '解鎖後依研究卡分批建倉',
          page: PAGES.trades,
          handbookSlug: '07',
        },
      ],
    },
    {
      number: 5,
      title: '風控與檢討：用結果修正自己',
      summary: '每季做績效歸因，每筆交易事後檢討，區分運氣與能力。',
      steps: [
        {
          id: '5.1',
          title: '完成第一次季度績效歸因',
          done: state.performanceReviews.length > 0,
          detail: '在投資組合頁新增季度檢討',
          page: PAGES.portfolio,
          handbookSlug: '08',
        },
        {
          id: '5.2',
          title: '完成第一次交易事後檢討',
          done: state.trades.some((t) => t.review6m || t.review12m),
          detail: '交易滿 6 個月後在交易日誌檢討',
          page: PAGES.trades,
          handbookSlug: '04',
        },
      ],
    },
  ]

  const withDone: JourneyStage[] = stages.map((s) => ({ ...s, done: s.steps.every((step) => step.done) }))
  const allSteps = withDone.flatMap((s) => s.steps)
  const missingForSatellite = allSteps.filter((s) => SATELLITE_PREREQUISITES.includes(s.id) && !s.done)

  return {
    stages: withDone,
    nextStep: allSteps.find((s) => !s.done) ?? null,
    completedCount: allSteps.filter((s) => s.done).length,
    totalCount: allSteps.length,
    satelliteUnlocked: missingForSatellite.length === 0,
    missingForSatellite,
  }
}

function criterion(label: string, current: number, target: number): StageCriterion {
  return { label, current, target, met: current >= target }
}

// Promotion follows the handbook's ten-year roadmap. Three consecutive years
// of the satellite lagging its benchmark drops the learner back one stage.
export function computeLearningStage(state: JourneyState, today: string): LearningStage {
  const policy = state.investmentPolicy
  const completeTheses = state.stockTheses.filter((t) => evaluateThesis(t, policy).isComplete).length
  const macroMonths = distinctMonths(state.macroCheckIns.map((c) => c.date))
  const discipline = computeDiscipline(state.trades, state.holdings, state.stockTheses, policy, today).score ?? 0
  const reviewedTrades = state.trades.filter((t) => t.review6m || t.review12m).length
  const attribution = summarizeAttribution(state.performanceReviews, policy)
  const years = attribution.yearlySatellite
  const lastYear = years[years.length - 1]
  const lastYearGapPoints = lastYear ? (lastYear.satelliteReturn - lastYear.benchmarkReturn) * 100 : null
  let consecutiveBeatingYears = 0
  for (let i = years.length - 1; i >= 0; i--) {
    if (years[i].satelliteReturn < years[i].benchmarkReturn) break
    consecutiveBeatingYears += 1
  }

  const criteriaByStage: StageCriterion[][] = [
    [
      criterion('總經檢視涵蓋月數', macroMonths, 12),
      criterion('完整研究卡', completeTheses, 10),
      criterion('紀律分數', discipline, 75),
    ],
    [
      criterion('研究卡', state.stockTheses.length, 20),
      criterion('已完成事後檢討的交易', reviewedTrades, 15),
      {
        label: '最近一年衛星落後基準不超過 3 個百分點',
        current: lastYearGapPoints === null ? 0 : Math.round(lastYearGapPoints * 10) / 10,
        target: -3,
        met: lastYearGapPoints !== null && lastYearGapPoints >= -3,
      },
    ],
    [criterion('衛星連續勝過基準年數', consecutiveBeatingYears, 3)],
    [],
  ]

  let stage = 1
  while (stage < 4 && criteriaByStage[stage - 1].every((c) => c.met)) stage += 1
  const demoted = attribution.consecutiveSatelliteLaggingYears >= 3 && stage > 1
  if (demoted) stage -= 1

  return {
    stage: stage as LearningStage['stage'],
    title: LEARNING_STAGE_TITLES[stage - 1],
    satelliteCapPercent: Math.min(STAGE_CAPS[stage - 1], policy.satellitePercent),
    demoted,
    nextCriteria: criteriaByStage[stage - 1],
  }
}

// The investment policy with its satellite cap narrowed to the learning stage.
export function effectivePolicy(policy: InvestmentPolicy, learning: LearningStage): InvestmentPolicy {
  return { ...policy, satellitePercent: learning.satelliteCapPercent }
}
