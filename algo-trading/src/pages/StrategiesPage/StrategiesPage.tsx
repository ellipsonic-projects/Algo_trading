import { useNavigate } from 'react-router-dom'
import { ArrowRight, Zap, TrendingUp, BarChart2, Clock, Target, Activity } from 'lucide-react'

import StrategiesLayout from './StrategiesLayout'

type StrategyCard = {
  title: string
  description: string
  to: string
  icon: any
}

export default function StrategiesPage() {
  const navigate = useNavigate()

  const cards: StrategyCard[] = [
    {
      title: 'Manual Trading',
      description: 'Place trades manually with live price and margin info.',
      to: '/strategies/manual-trading',
      icon: Activity,
    },
    {
      title: 'Ichimoku strategy',
      description: 'Trend + momentum strategy using Ichimoku Cloud.',
      to: '/strategies/ichimoku',
      icon: BarChart2,
    },
    {
      title: '5 min breakout',
      description: 'Breakout strategy based on 5-minute range.',
      to: '/strategies/5-min-breakout',
      icon: Zap,
    },
    {
      title: 'VWAP + SMMA',
      description: 'Mean reversion / trend confirmation using VWAP + SMMA.',
      to: '/strategies/vwap-smma',
      icon: Clock,
    },
    {
      title: 'Expiry strategy',
      description: 'Expiry day logic and risk controls (placeholder).',
      to: '/strategies/expiry',
      icon: Target,
    },
    {
      title: 'Heikenashi',
      description: 'Trend following strategy using Heiken Ashi candles.',
      to: '/strategies/heikenashi',
      icon: TrendingUp,
    },
    {
      title: 'Modified Heikenashi',
      description: 'Modified Heiken Ashi logic.',
      to: '/strategies/modified-heikenashi',
      icon: TrendingUp,
    },
  ]

  return (
    <StrategiesLayout
      title="Select Algorithmic Strategy"
      subtitle="Launch institutional automated trading rules or use manual ticket."
      backTo="/dashboard"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 select-none">
        {cards.map((c) => {
          const IconComp = c.icon
          return (
            <button
              key={c.title}
              type="button"
              onClick={() => navigate(c.to)}
              className="group text-left p-4 rounded border border-[#E0E3EB] bg-white hover:border-[#0052FF] hover:shadow-sm transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-[#F0F3FA] rounded flex items-center justify-center text-[#0052FF] group-hover:bg-[#0052FF] group-hover:text-white transition-colors">
                      <IconComp className="w-3.5 h-3.5" />
                    </div>
                    <h2 className="text-xs font-bold text-[#1E222D] tracking-tight">{c.title}</h2>
                  </div>
                  <span className="text-[10px] font-bold text-[#0052FF] group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                    Launch <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
                <p className="text-xs text-[#787B86] font-medium leading-relaxed">{c.description}</p>
              </div>

              <div className="mt-4 pt-2.5 border-t border-[#E0E3EB] flex items-center justify-between text-[10px] font-semibold text-[#787B86]">
                <span>Status: Ready</span>
                <span className="text-[#089981] font-bold">Institutional Grade</span>
              </div>
            </button>
          )
        })}
      </div>
    </StrategiesLayout>
  )
}

