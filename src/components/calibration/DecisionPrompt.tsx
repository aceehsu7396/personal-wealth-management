import { Link } from 'react-router-dom'
import type { DecisionKind } from '../../lib/storage/schema'

// After a rule set is signed: offer to record it as a decision with a
// pre-mortem (handbook 04 §5).
export function DecisionPrompt({ kind, title, reasons }: { kind: DecisionKind; title: string; reasons: string }) {
  const q = new URLSearchParams({ decision: 'new', kind, title, reasons })
  return (
    <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
      已簽署。要不要同時寫一筆決策紀錄，留下判斷、信心與事前驗屍，日後回頭對答案？{' '}
      <Link to={`/portfolio/calibration?${q.toString()}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
        寫決策紀錄
      </Link>
    </p>
  )
}
