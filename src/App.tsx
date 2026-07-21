import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NavBar } from './components/layout/NavBar'
import { FireCalculatorPage } from './pages/FireCalculatorPage'
import { ProgressTrackerPage } from './pages/ProgressTrackerPage'
import { MarketCheckInPage } from './pages/MarketCheckInPage'

function App() {
  return (
    <HashRouter>
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
        <NavBar />
        <Routes>
          <Route path="/" element={<Navigate to="/fire" replace />} />
          <Route path="/fire" element={<FireCalculatorPage />} />
          <Route path="/market" element={<MarketCheckInPage />} />
          <Route path="/progress" element={<ProgressTrackerPage />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
