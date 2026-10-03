export function formatCurrency(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatYearsToFire(years: number): string {
  const wholeYears = Math.floor(years)
  const months = Math.round((years - wholeYears) * 12)
  if (wholeYears === 0) return `${months} 個月`
  if (months === 0) return `${wholeYears} 年`
  return `${wholeYears} 年 ${months} 個月`
}

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
  }).format(new Date(isoDate))
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })
}

export function formatRatio(value: number): string {
  if (value === Infinity) return '∞'
  return value.toFixed(2)
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}
