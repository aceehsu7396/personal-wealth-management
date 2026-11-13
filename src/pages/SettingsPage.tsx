import { ProfileForm } from '../components/forms/ProfileForm'
import { GuardrailsForm } from '../components/forms/GuardrailsForm'
import { DataManagement } from '../components/DataManagement'
import { DemoControl } from '../components/DemoBanner'
import { AiKeySettings } from '../components/AiKeySettings'
import { SyncCard } from '../components/settings/SyncCard'
import { PageHeader } from '../components/ui'

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="設定" summary="個人資料、建議規則參數、同步與推播，以及資料管理。" />

      <div className="mt-8">
        <SyncCard />
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">個人資料</h2>
        <div className="mt-4">
          <ProfileForm />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          建議規則參數
        </h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          影響總經三支柱的股票傾斜上限、股票配置下限，以及投資組合的再平衡帶。
        </p>
        <div className="mt-4">
          <GuardrailsForm />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          AI 網路研究設定
        </h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          用於市場分析（預填總經三支柱）、產業分析、個股分析（預填研究卡事實數據）。AI 會上網搜尋並附上資料來源；費用直接計入你的 Anthropic 帳戶，每次分析約 US$0.1–0.5，按下按鈕才會執行。各頁的「AI 說明」只產生提示詞讓你貼到自己的 Claude 對話，不需要金鑰。
        </p>
        <div className="mt-4">
          <AiKeySettings />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">示範資料</h2>
        <div className="mt-4">
          <DemoControl />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">資料管理</h2>
        <div className="mt-4">
          <DataManagement />
        </div>
      </div>
    </div>
  )
}
