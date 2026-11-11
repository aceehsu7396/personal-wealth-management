// The four tones every page uses (docs/ui-guidelines.md §7).
export type Tone = 'good' | 'warn' | 'bad' | 'info'

export const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  bad: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  info: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
}
