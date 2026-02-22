import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  Zap,
  Clock,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Wallet
} from 'lucide-react';

import { apiGet } from '../../trading';

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState({
    totalPnl: 0,
    activeStrategies: 0,
    winRate: 0,
    totalTrades: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [tradesData, stratsData] = await Promise.all([
          apiGet<any>('/trades/stats'),
          apiGet<any>('/strategies/count')
        ]);
        if (tradesData && stratsData) {
          setStats({
            totalPnl: tradesData.data.totalPnl,
            totalTrades: tradesData.data.totalTrades,
            winRate: tradesData.data.winRate,
            activeStrategies: stratsData.data.count
          });
        }
      } catch (err) {
        console.error('Failed to fetch dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const cards = [
    { name: 'Total PNL', value: `₹${stats.totalPnl.toLocaleString()}`, change: stats.totalPnl >= 0 ? '+Live' : '-Live', isPositive: stats.totalPnl >= 0, icon: Wallet },
    { name: 'Your Strategies', value: stats.activeStrategies.toString(), change: 'Active', isPositive: true, icon: Zap },
    { name: 'Win Rate', value: `${stats.winRate}%`, change: stats.winRate > 50 ? 'Strong' : 'Steady', isPositive: stats.winRate > 50, icon: Activity },
    { name: 'Total Trades', value: stats.totalTrades.toString(), change: 'Executed', isPositive: true, icon: Clock },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">System Overview</h1>
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">Real-time performance metrics</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((stat) => (
          <div key={stat.name} className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-white/5 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all group">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-slate-50 dark:bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-cyan-500 transition-colors text-slate-400 dark:text-slate-500 group-hover:text-white">
                <stat.icon className="w-6 h-6" />
              </div>
              <span className={`text-xs font-black px-2 py-1 rounded-lg flex items-center gap-1 ${stat.isPositive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                {stat.isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {stat.change}
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.name}</p>
            <h3 className={`text-2xl font-black mt-1 ${loading ? 'animate-pulse text-slate-300' : 'text-slate-900 dark:text-white'}`}>
              {loading ? '...' : stat.value}
            </h3>
          </div>
        ))}
      </div>

      {/* Performance Chart Placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm min-h-[400px] flex flex-col justify-center items-center text-center">
          <div className="w-20 h-20 bg-cyan-500/10 rounded-full flex items-center justify-center mb-4">
            <TrendingUp className="w-10 h-10 text-cyan-500" />
          </div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white">Equity Curve Visualization</h3>
          <p className="text-slate-500 dark:text-slate-400 font-medium max-w-sm mt-2">Connecting your broker provides real-time performance analytics and equity curve tracking based on your trade history.</p>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Execution Log</h3>
            <div className="space-y-4">
              {stats.totalTrades === 0 ? (
                <p className="text-xs text-slate-500 font-medium text-center py-10 italic">No trades executed yet.</p>
              ) : (
                [1, 2, 3].map(i => (
                  <div key={i} className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all cursor-pointer">
                    <div className="w-2 h-2 mt-2 rounded-full bg-cyan-500 shadow-lg shadow-cyan-500/50" />
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">System Notification</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mt-1">Algo Engine • Monitoring Live</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-8 rounded-[2rem] shadow-xl shadow-cyan-500/20 text-white relative overflow-hidden group hover:scale-[1.02] transition-transform">
            <Zap className="absolute -bottom-4 -right-4 w-32 h-32 opacity-10 group-hover:rotate-12 transition-transform duration-500" />
            <h3 className="text-xl font-black relative z-10">Strategy Builder</h3>
            <p className="text-white/80 text-xs font-bold mt-2 relative z-10">Configure and deploy new algorithmic strategies from your terminal.</p>
            <button className="mt-6 px-6 py-2 bg-white text-cyan-600 text-xs font-black uppercase rounded-xl relative z-10 hover:shadow-lg transition-shadow">
              Go to Strategies
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
