import type { TradePlan } from '../../lib/storage/schema'
import type { Tone } from '../ui'

export const ENTRY_METHOD_LABELS: Record<TradePlan['entryMethod'], string> = {
  value_batches: '價值區間分批',
  breakout: '突破',
  pullback: '拉回',
  mean_reversion: '均值回歸',
  momentum: '動能輪動',
  event: '事件與財報',
  dca: '定期定額',
  other: '其他',
}

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
