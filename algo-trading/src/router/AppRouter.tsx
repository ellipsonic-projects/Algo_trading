import { Navigate, Route, Routes } from 'react-router-dom'

import LoginPage from '../pages/LoginPage/LoginPage'
import ExpiryStrategyPage from '../pages/StrategiesPage/ExpiryStrategyPage'
import FiveMinBreakoutPage from '../pages/StrategiesPage/FiveMinBreakoutPage'
import IchimokuStrategyPage from '../pages/StrategiesPage/IchimokuStrategyPage'
import StrategiesPage from '../pages/StrategiesPage/StrategiesPage'
import ManualTradingPage from '../pages/StrategiesPage/ManualTradingPage'
import VwapSmmaPage from '../pages/StrategiesPage/VwapSmmaPage'
import HeikenashiPage from '../pages/StrategiesPage/HeikenashiPage'

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/strategies" element={<StrategiesPage />} />
      <Route path="/strategies/manual-trading" element={<ManualTradingPage />} />
      <Route path="/strategies/ichimoku" element={<IchimokuStrategyPage />} />
      <Route path="/strategies/5-min-breakout" element={<FiveMinBreakoutPage />} />
      <Route path="/strategies/vwap-smma" element={<VwapSmmaPage />} />
      <Route path="/strategies/expiry" element={<ExpiryStrategyPage />} />
      <Route path="/strategies/heikenashi" element={<HeikenashiPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
