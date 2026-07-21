export function nextReviewDate(latestDate: string, reviewCadenceMonths: number): Date {
  const next = new Date(latestDate)
  next.setMonth(next.getMonth() + reviewCadenceMonths)
  return next
}

export function isReviewDue(
  latestDate: string | undefined,
  reviewCadenceMonths: number,
): boolean {
  if (!latestDate) return true
  return nextReviewDate(latestDate, reviewCadenceMonths) <= new Date()
}
