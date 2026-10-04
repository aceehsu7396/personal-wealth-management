import { ProfileForm } from '../components/forms/ProfileForm'
import { GuardrailsForm } from '../components/forms/GuardrailsForm'
import { DataManagement } from '../components/DataManagement'
import { AiKeySettings } from '../components/AiKeySettings'

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">設定</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        個人資料、建議規則參數與資料管理。
      </p>

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
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          影響「市場檢視」頁面產生的再平衡帶、配置微調上限與檢視提醒週期。
        </p>
        <div className="mt-4">
          <GuardrailsForm />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          AI 研究摘要設定
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          用於「市場檢視」頁面產生大盤與 0050 的 AI 研究摘要。
        </p>
        <div className="mt-4">
          <AiKeySettings />
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
