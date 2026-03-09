import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Zap,
    ChevronDown,
    ChevronRight,
    Target,
    Activity,
    BarChart3,
    Clock,
    TrendingUp,
    ShieldAlert,
    History
} from 'lucide-react';

const Sidebar: React.FC = () => {
    const location = useLocation();
    const [isStrategiesOpen, setIsStrategiesOpen] = useState(true);

    const strategies = [
        { name: 'Manual Trading', path: '/strategies/manual-trading', icon: Activity },
        { name: 'Heikenashi', path: '/strategies/heikenashi', icon: TrendingUp },
        { name: 'Mod Heikenashi', path: '/strategies/modified-heikenashi', icon: TrendingUp },
        { name: '5-Min Breakout', path: '/strategies/5-min-breakout', icon: Zap },
        { name: 'Ichimoku', path: '/strategies/ichimoku', icon: BarChart3 },
        { name: 'VWAP SMMA', path: '/strategies/vwap-smma', icon: Clock },
        { name: 'Expiry Strategy', path: '/strategies/expiry', icon: Target },
    ];

    const isActive = (path: string) => location.pathname === path;
    const isStrategyActive = strategies.some(s => isActive(s.path));

    return (
        <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/5 h-screen flex flex-col transition-colors sticky top-0">
            <div className="p-6 flex items-center gap-3">
                <div className="w-8 h-8 bg-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
                    <ShieldAlert className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white">OptionAlgo</span>
            </div>

            <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto custom-scrollbar">
                <p className="px-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Main Menu</p>

                <NavLink
                    to="/dashboard"
                    className={({ isActive }) => `
                        flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 group
                        ${isActive
                            ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold'
                            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 dark:text-slate-400'}
                    `}
                >
                    <LayoutDashboard className={`w-5 h-5 ${isActive('/dashboard') ? 'text-cyan-500' : 'group-hover:text-cyan-500'}`} />
                    <span>Dashboard</span>
                </NavLink>

                <NavLink
                    to="/trades"
                    className={({ isActive }) => `
                        flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 group
                        ${isActive
                            ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold'
                            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 dark:text-slate-400'}
                    `}
                >
                    <History className={`w-5 h-5 ${isActive('/trades') ? 'text-cyan-500' : 'group-hover:text-cyan-500'}`} />
                    <span>Trades</span>
                </NavLink>

                <div className="space-y-1">
                    <button
                        onClick={() => setIsStrategiesOpen(!isStrategiesOpen)}
                        className={`
                            w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-200 group
                            ${isStrategyActive
                                ? 'text-cyan-600 dark:text-cyan-400 font-bold'
                                : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 dark:text-slate-400'}
                        `}
                    >
                        <div className="flex items-center gap-3">
                            <Zap className={`w-5 h-5 ${isStrategyActive ? 'text-cyan-500' : 'group-hover:text-cyan-500'}`} />
                            <span>Strategies</span>
                        </div>
                        {isStrategiesOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>

                    {isStrategiesOpen && (
                        <div className="ml-4 pl-4 border-l border-slate-100 dark:border-white/5 mt-1 space-y-1 animate-in slide-in-from-left-2 duration-200">
                            {strategies.map((strat) => (
                                <NavLink
                                    key={strat.path}
                                    to={strat.path}
                                    className={({ isActive }) => `
                                        flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 text-sm
                                        ${isActive
                                            ? 'text-cyan-500 bg-cyan-50 dark:bg-cyan-500/5 font-semibold'
                                            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 dark:text-slate-400'}
                                    `}
                                >
                                    <strat.icon className="w-4 h-4 opacity-70" />
                                    <span>{strat.name}</span>
                                </NavLink>
                            ))}
                        </div>
                    )}
                </div>
            </nav>

            <div className="p-4 border-t border-slate-100 dark:border-white/5">
                <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-white/5 dark:to-white/[0.02] p-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-2">System Status</p>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Algo Engine Ready</span>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
