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
