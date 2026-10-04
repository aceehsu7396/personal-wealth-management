export const inputClass =
  'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
export const labelClass = 'text-sm font-medium text-gray-700 dark:text-gray-300'
export const errorClass = 'mt-1 text-xs text-red-600 dark:text-red-400'

export function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {error && <p className={errorClass}>{error}</p>}
    </label>
  )
}
