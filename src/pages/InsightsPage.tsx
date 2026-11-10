import { MarkdownView } from '../components/MarkdownView'
import content from '../../docs/insights/全職交易者心得.md?raw'

// In-app routes in the document ("/handbook/11", "/goals") stay in the app.
const resolveLink = (href: string) => (href.startsWith('/') ? href : null)

// Temporary page: online notes from full-time traders, gathered as
// reference material (not part of the handbook's method).
export function InsightsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        暫用頁面：網路上台灣全職交易者的交易心得整理，整理於 2026-11-10。內容是個人經驗分享，僅供參考，不是投資建議；有感觸的地方可以用右下角的「✎ 筆記」記成心得。
      </p>
      <article className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <MarkdownView content={content} resolveLink={resolveLink} />
      </article>
    </div>
  )
}
