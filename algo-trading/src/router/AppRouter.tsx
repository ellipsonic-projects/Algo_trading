import { Navigate, Route, Routes } from 'react-router-dom'

import DashboardPage from '../pages/DashboardPage/DashboardPage'
import LoginPage from '../pages/LoginPage/LoginPage'

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
