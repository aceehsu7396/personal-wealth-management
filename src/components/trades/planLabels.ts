import type { TradePlan } from '../../lib/storage/schema'
import type { Tone } from '../ui'

export { ENTRY_METHOD_LABELS } from '../../lib/trades/tradePlan'

export const STOP_METHOD_LABELS: Record<TradePlan['stopMethod'], string> = {
  structure: '結構（前低、支撐）',
  atr: 'ATR 倍數',
  percent: '固定百分比',
  manual: '手動',
}

export const TRAILING_LABELS: Record<TradePlan['trailing'], string> = {
  none: '不移動',
  chandelier: '吊燈式（最高價 − k × ATR）',
  moving_average: '均線',
  swing_low: '前低',
}

export const PLAN_STATUS: Record<TradePlan['status'], { label: string; tone: Tone }> = {
  draft: { label: '草稿', tone: 'info' },
  open: { label: '進行中', tone: 'good' },
  closed: { label: '已結束', tone: 'info' },
  cancelled: { label: '已放棄', tone: 'info' },
}
