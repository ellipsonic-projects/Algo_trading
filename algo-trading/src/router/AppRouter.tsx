import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './ProtectedRoute';
import DashboardLayout from '../components/Layout/DashboardLayout';

// Lazy load all major page components to optimize bundle performance (Audit #27)
const LoginPage = React.lazy(() => import('../pages/LoginPage/LoginPage'));
const DashboardPage = React.lazy(() => import('../pages/DashboardPage/DashboardPage'));
const StrategiesPage = React.lazy(() => import('../pages/StrategiesPage/StrategiesPage'));
const ManualTradingPage = React.lazy(() => import('../pages/StrategiesPage/ManualTradingPage'));
const FiveMinBreakoutPage = React.lazy(() => import('../pages/StrategiesPage/FiveMinBreakoutPage'));
const HeikenashiPage = React.lazy(() => import('../pages/StrategiesPage/HeikenashiPage'));
const ModifiedHeikenashiPage = React.lazy(() => import('../pages/StrategiesPage/ModifiedHeikenashiPage'));
const DynamicStrategyPage = React.lazy(() => import('../pages/StrategiesPage/DynamicStrategyPage'));
const TradesPage = React.lazy(() => import('../pages/TradesPage/TradesPage'));

export default function AppRouter() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-screen items-center justify-center bg-[#F8F9FA]">
        <div className="text-xs font-semibold text-[#787B86] animate-pulse">Loading Terminal...</div>
      </div>
    }>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Protected Routes Wrapper */}
        <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/strategies/manual-trading" element={<ManualTradingPage />} />
          
          {/* Audit #22: Disable navigation to incomplete placeholders by redirecting back to list */}
          <Route path="/strategies/ichimoku" element={<Navigate to="/strategies" replace />} />
          <Route path="/strategies/vwap-smma" element={<Navigate to="/strategies" replace />} />
          <Route path="/strategies/expiry" element={<Navigate to="/strategies" replace />} />
          
          <Route path="/strategies/5-min-breakout" element={<FiveMinBreakoutPage />} />
          <Route path="/strategies/heikenashi" element={<HeikenashiPage />} />
          <Route path="/strategies/modified-heikenashi" element={<ModifiedHeikenashiPage />} />
          <Route path="/strategies/plugin/:strategyId" element={<DynamicStrategyPage />} />
          <Route path="/trades" element={<TradesPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
