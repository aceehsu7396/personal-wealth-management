import { useEffect, useRef, useState } from 'react'
import { GLOSSARY } from '../lib/glossary'

const WIDTH = 256

// A label with a small "?" that opens its plain-language definition. The
// popup is fixed to the viewport so scrolling tables do not clip it.
export function Term({ name, children }: { name: string; children?: React.ReactNode }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const text = GLOSSARY[name]

  useEffect(() => {
    if (!at) return
    const close = (e: Event) => {
      if (e.type === 'scroll' || !button.current?.contains(e.target as Node)) setAt(null)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('pointerdown', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('pointerdown', close)
    }
  }, [at])

  if (!text) return <>{children ?? name}</>

  function toggle() {
    if (at) return setAt(null)
    const rect = button.current?.getBoundingClientRect()
    if (!rect) return
    setAt({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - WIDTH - 8)) })
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      {children ?? name}
      <button
        ref={button}
        type="button"
        aria-label={`${name}是什麼`}
        aria-expanded={at !== null}
        onClick={toggle}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] leading-none font-medium text-gray-500 hover:border-indigo-500 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-400"
      >
        ?
      </button>
      {at && (
        <span
          role="tooltip"
          style={{ top: at.top, left: at.left, width: WIDTH }}
          className="fixed z-50 rounded-md border border-gray-200 bg-white p-2 text-left text-xs font-normal normal-case leading-5 whitespace-normal text-gray-700 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <strong className="text-gray-900 dark:text-gray-100">{name}</strong>：{text}
        </span>
      )}
    </span>
  )
}
