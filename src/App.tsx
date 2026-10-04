import { lazy, Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { NavBar } from './components/layout/NavBar'
import { DashboardPage } from './pages/DashboardPage'
import { FireCalculatorPage } from './pages/FireCalculatorPage'
import { ProgressTrackerPage } from './pages/ProgressTrackerPage'
import { MarketCheckInPage } from './pages/MarketCheckInPage'
import { MonthlyRecordsPage } from './pages/MonthlyRecordsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StrategyPage } from './pages/StrategyPage'
import { ResearchPage } from './pages/ResearchPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { TradesPage } from './pages/TradesPage'
import { JourneyPage } from './pages/JourneyPage'

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
          <Route path="/" element={<DashboardPage />} />
          <Route path="/journey" element={<JourneyPage />} />
          <Route path="/fire" element={<FireCalculatorPage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/market" element={<MarketCheckInPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/trades" element={<TradesPage />} />
          <Route
            path="/handbook/:slug?"
            element={
              <Suspense fallback={<p className="px-4 py-10 text-center text-sm text-gray-500">載入手冊中…</p>}>
                <HandbookPage />
              </Suspense>
            }
          />
          <Route path="/progress" element={<ProgressTrackerPage />} />
          <Route path="/records" element={<MonthlyRecordsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
