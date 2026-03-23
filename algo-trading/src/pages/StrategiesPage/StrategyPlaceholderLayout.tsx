import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { usePageTitle } from '../../hooks/usePageTitle'

export default function StrategyPlaceholderLayout({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title)
  const navigate = useNavigate()

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500 uppercase tracking-widest text-[10px]">Algorithm Pending Deployment</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/strategies/manual-trading')}
          className="flex items-center gap-2 px-6 py-3 bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20 text-xs font-black uppercase tracking-widest rounded-xl transition-all"
        >
          Open Manual Terminal
        </button>
      </div>
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-12 shadow-sm dark:border-white/5 dark:bg-slate-900 flex flex-col items-center justify-center text-center min-h-[400px]">
        <div className="w-16 h-16 bg-slate-50 dark:bg-white/5 rounded-2xl flex items-center justify-center border border-slate-100 dark:border-white/5 mb-6">
          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-ping" />
        </div>
        <p className="text-slate-900 dark:text-white font-black text-lg mb-2">Strategy logic under development</p>
        <p className="text-slate-500 text-sm max-w-sm font-medium">This algorithm is currently being optimized for high-frequency execution. Switch to the manual terminal for instant order placement.</p>
        <div className="mt-8 flex gap-4">
          {children}
        </div>
      </section>
    </div>
  )
}
