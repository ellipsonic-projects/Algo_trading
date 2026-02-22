import { useNavigate } from 'react-router-dom'

import StrategiesLayout from './StrategiesLayout'

type StrategyCard = {
  title: string
  description: string
  to: string
  accentClassName: string
}

export default function StrategiesPage() {
  const navigate = useNavigate()

  const cards: StrategyCard[] = [
    {
      title: 'Manual Trading',
      description: 'Place trades manually with live price and margin info.',
      to: '/strategies/manual-trading',
      accentClassName: 'from-emerald-400 to-cyan-400',
    },
    {
      title: 'Ichimoku strategy',
      description: 'Trend + momentum strategy using Ichimoku Cloud.',
      to: '/strategies/ichimoku',
      accentClassName: 'from-cyan-400 to-violet-400',
    },
    {
      title: '5 min breakout',
      description: 'Breakout strategy based on 5-minute range.',
      to: '/strategies/5-min-breakout',
      accentClassName: 'from-amber-400 to-rose-400',
    },
    {
      title: 'VWAP + SMMA',
      description: 'Mean reversion / trend confirmation using VWAP + SMMA.',
      to: '/strategies/vwap-smma',
      accentClassName: 'from-fuchsia-400 to-indigo-400',
    },
    {
      title: 'Expiry strategy',
      description: 'Expiry day logic and risk controls (placeholder).',
      to: '/strategies/expiry',
      accentClassName: 'from-sky-400 to-emerald-400',
    },
    {
      title: 'Heikenashi',
      description: 'Trend following strategy using Heiken Ashi candles.',
      to: '/strategies/heikenashi',
      accentClassName: 'from-rose-400 to-orange-400',
    },
  ]

  return (
    <StrategiesLayout
      title="Select a Strategy"
      subtitle="Choose manual trading or launch an automated strategy."
      backTo="/login"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.title}
            type="button"
            onClick={() => navigate(c.to)}
            className={[
              'group text-left overflow-hidden rounded-2xl border shadow-sm transition',
              'border-slate-200 bg-white hover:shadow-lg dark:border-white/10 dark:bg-slate-900',
              'focus:outline-none focus:ring-4 focus:ring-cyan-200 dark:focus:ring-cyan-400/20',
            ].join(' ')}
          >
            <div className={['h-1 bg-gradient-to-r', c.accentClassName].join(' ')} />
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold">{c.title}</h2>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200">
                  Open
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{c.description}</p>
            </div>
          </button>
        ))}
      </div>
    </StrategiesLayout>
  )
}
