import { DemoBanner } from './components/DemoBanner'
import { StorageWarning } from './components/StorageWarning'
import { PageContext } from './components/PageContext'
import { NotesDrawer } from './components/notes/NotesDrawer'
import { NotesDrawerProvider } from './components/notes/NotesDrawerContext'
import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NavBar } from './components/layout/NavBar'
import { ScrollToTop } from './components/layout/ScrollToTop'
import { PortfolioSnapshotRecorder } from './components/PortfolioSnapshotRecorder'
import { HOME_PATH, LEGACY_REDIRECTS } from './components/layout/navigation'
import { DashboardPage } from './pages/DashboardPage'
import { GoalsPage } from './pages/GoalsPage'
import { JourneyPage } from './pages/JourneyPage'
import { MarketPage } from './pages/MarketPage'
import { StocksPage } from './pages/StocksPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { TradesPage } from './pages/TradesPage'
import { TradePlansPage } from './pages/TradePlansPage'
import { RiskPage } from './pages/RiskPage'
import { CalibrationPage } from './pages/CalibrationPage'
import { SyncProvider } from './components/settings/SyncProvider'
import { PortfolioReviewPage } from './pages/PortfolioReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { StrategiesPage } from './pages/StrategiesPage'
import { PaperPage } from './pages/PaperPage'
import { ScreenerPage } from './pages/ScreenerPage'
import { BacktestPage } from './pages/BacktestPage'
import { IdeaNotesPage } from './pages/IdeaNotesPage'
import { BlueprintPage } from './pages/BlueprintPage'

// The handbook bundles the Markdown renderer; load it only when opened.
const HandbookPage = lazy(() =>
  import('./pages/HandbookPage').then((m) => ({ default: m.HandbookPage })),
)

function App() {
  return (
    <HashRouter>
      <SyncProvider>
        <NotesDrawerProvider>
          {/* Bottom padding keeps the notes button off the last line of each page. */}
          <div className="min-h-svh bg-gray-50 pb-20 dark:bg-gray-900">
            <ScrollToTop />
            <NavBar />
            <DemoBanner />
            <StorageWarning />
            <PortfolioSnapshotRecorder />
            <PageContext />
            <Routes>
              <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
              {/* 研究分析 */}
              <Route path="/research/market" element={<MarketPage />} />
              <Route path="/research/screener" element={<ScreenerPage />} />
              <Route path="/research/stocks" element={<StocksPage />} />
              {/* 模擬交易 */}
              <Route path="/sim/strategies" element={<StrategiesPage />} />
              <Route path="/sim/backtest" element={<BacktestPage />} />
              <Route path="/sim/paper" element={<PaperPage />} />
              {/* 投資持有與檢討回顧 */}
              <Route path="/today" element={<DashboardPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/portfolio/plans" element={<TradePlansPage />} />
              <Route path="/portfolio/risk" element={<RiskPage />} />
              <Route path="/portfolio/trades" element={<TradesPage />} />
              <Route path="/portfolio/review" element={<PortfolioReviewPage />} />
              <Route path="/portfolio/calibration" element={<CalibrationPage />} />
              {/* 交易心得已併入手冊附錄 E */}
              <Route path="/insights" element={<Navigate to="/handbook/附錄E" replace />} />
              <Route path="/blueprint/:slug?" element={<BlueprintPage />} />
              {/* 筆記、手冊與行動路線、設定 */}
              <Route path="/notes" element={<IdeaNotesPage />} />
              <Route
                path="/handbook/:slug?"
                element={
                  <Suspense fallback={<p className="px-4 py-10 text-center text-sm text-gray-500">載入手冊中…</p>}>
                    <HandbookPage />
                  </Suspense>
                }
              />
              <Route path="/journey" element={<JourneyPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
                <Route key={from} path={from} element={<Navigate to={to} replace />} />
              ))}
              <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
            </Routes>
            <NotesDrawer />
          </div>
        </NotesDrawerProvider>
      </SyncProvider>
    </HashRouter>
  )
}

export default App
