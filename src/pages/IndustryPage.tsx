import { IndustryAnalysisPanel } from '../components/research/IndustryAnalysisPanel'

export function IndustryPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">產業</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        先看懂產業，再挑公司：AI 上網整理產業生命週期、五力、供應鏈、趨勢與代表公司，作為寫研究卡的素材。報告不是買進名單，五力評分與論點仍由你判斷。
      </p>
      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <IndustryAnalysisPanel />
      </div>
    </div>
  )
}
