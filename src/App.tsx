import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NavBar } from './components/layout/NavBar'
import { LEGACY_REDIRECTS } from './components/layout/navigation'
import { DashboardPage } from './pages/DashboardPage'
import { GoalsPage } from './pages/GoalsPage'
import { NetWorthPage } from './pages/NetWorthPage'
import { JourneyPage } from './pages/JourneyPage'
import { MarketPage } from './pages/MarketPage'
import { IndustryPage } from './pages/IndustryPage'
import { StocksPage } from './pages/StocksPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { TradesPage } from './pages/TradesPage'
import { PortfolioReviewPage } from './pages/PortfolioReviewPage'
import { SettingsPage } from './pages/SettingsPage'

// The handbook bundles the Markdown renderer; load it only when opened.
const HandbookPage = lazy(() =>
  import('./pages/HandbookPage').then((m) => ({ default: m.HandbookPage })),
)

function App() {
  return (
    <HashRouter>
      <div className="min-h-svh bg-gray-50 dark:bg-gray-900">
        <NavBar />
        <Routes>
          {/* 總覽 */}
          <Route path="/" element={<DashboardPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/networth" element={<NetWorthPage />} />
          {/* 學習路線 */}
          <Route path="/journey" element={<JourneyPage />} />
          <Route
            path="/handbook/:slug?"
            element={
              <Suspense fallback={<p className="px-4 py-10 text-center text-sm text-gray-500">載入手冊中…</p>}>
                <HandbookPage />
              </Suspense>
            }
          />
          {/* 研究分析 */}
          <Route path="/research/market" element={<MarketPage />} />
          <Route path="/research/industry" element={<IndustryPage />} />
          <Route path="/research/stocks" element={<StocksPage />} />
          {/* 投資組合 */}
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/portfolio/trades" element={<TradesPage />} />
          <Route path="/portfolio/review" element={<PortfolioReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
