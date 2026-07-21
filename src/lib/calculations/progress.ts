export function computeProgressPercent(
  latestNetWorth: number,
  fireNumber: number,
): number | null {
  if (!Number.isFinite(fireNumber) || fireNumber <= 0) return null
  return (latestNetWorth / fireNumber) * 100
}
