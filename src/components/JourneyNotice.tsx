import { Link } from 'react-router-dom'
import type { JourneyStep } from '../lib/calculations/journey'

// Shown on satellite-related pages until the action roadmap prerequisites are
// done. It guides rather than blocks: the page stays usable.
export function JourneyNotice({ missing, intro }: { missing: JourneyStep[]; intro: string }) {
  if (missing.length === 0) return null
  return (
    <div className="mt-6 rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-900 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-200">
      <p className="font-medium">{intro}</p>
      <ul className="mt-2 space-y-1">
        {missing.map((step) => (
          <li key={step.id}>
            <Link to={step.page.to} className="hover:underline">
              ☐ {step.id} {step.title}：{step.detail}
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/journey" className="mt-2 inline-block text-xs font-medium underline">
        查看完整行動路線
      </Link>
    </div>
  )
}
