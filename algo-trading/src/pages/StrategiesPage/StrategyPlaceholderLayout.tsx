import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import StrategiesLayout from './StrategiesLayout'

export default function StrategyPlaceholderLayout({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate()

  return (
    <StrategiesLayout title={title} subtitle={`This is ${title} page`} backTo="/strategies">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => navigate('/strategies/manual-trading')}
          className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
        >
          Manual Trading
        </button>
      </div>
      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        {children}
      </section>
    </StrategiesLayout>
  )
}
