import type { DecisionKind } from '../../lib/storage/schema'

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = { tilt: '戰術傾斜', regime_params: '局勢參數', policy: '投資政策', other: '其他' }
