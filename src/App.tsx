import { HashRouter, Route, Routes } from 'react-router-dom'
import { NavBar } from './components/layout/NavBar'
import { DashboardPage } from './pages/DashboardPage'
import { FireCalculatorPage } from './pages/FireCalculatorPage'
import { ProgressTrackerPage } from './pages/ProgressTrackerPage'
import { MarketCheckInPage } from './pages/MarketCheckInPage'
import { MonthlyRecordsPage } from './pages/MonthlyRecordsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StrategyPage } from './pages/StrategyPage'

function App() {
  return (
    <HashRouter>
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
        <NavBar />
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/fire" element={<FireCalculatorPage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/market" element={<MarketCheckInPage />} />
          <Route path="/progress" element={<ProgressTrackerPage />} />
          <Route path="/records" element={<MonthlyRecordsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
