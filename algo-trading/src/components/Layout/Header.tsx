import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../shared/theme/ThemeProvider';
import {
    Sun,
    Moon,
    LogOut,
    User as UserIcon,
    Unplug,
    Settings,
    Bell,
    ChevronDown
} from 'lucide-react';
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider';

const Header: React.FC = () => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const { connectStatus, openConnect, disconnect } = useAngelConnection();
    const location = useLocation();

    const handleLogout = async () => {
        try {
            await logout();
            window.location.href = '/login';
        } catch (err) {
            console.error('Logout failed:', err);
        }
    };

    const getPageTitle = () => {
        const path = location.pathname;
        if (path === '/dashboard') return 'System Dashboard';
        if (path.startsWith('/strategies/')) {
            const strat = path.split('/').pop()?.replace(/-/g, ' ');
            return strat ? strat.charAt(0).toUpperCase() + strat.slice(1) : 'Trading Strategy';
        }
        return 'Trading Terminal';
    };

    return (
        <header className="h-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-white/5 px-8 flex items-center justify-between sticky top-0 z-30 transition-colors">
            <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 capitalize">
                    {getPageTitle()}
                    <span className="text-[10px] bg-cyan-500/10 text-cyan-600 px-2 py-0.5 rounded-full uppercase tracking-widest font-black">Live</span>
                </h2>
            </div>

            <div className="flex items-center gap-6">
                {/* Angel One Connection Status */}
                <div className="hidden md:flex items-center gap-3 pr-6 border-r border-slate-200 dark:border-white/5">
                    <button
                        onClick={connectStatus === 'connected' ? disconnect : openConnect}
                        className={`
                        flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all
                        ${connectStatus === 'connected'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/20'}
                    `}>
                        <Unplug className="w-4 h-4" />
                        {connectStatus === 'connected' ? 'Connected' : 'Connect Broker'}
                    </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                        title="Toggle Theme"
                    >
                        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>

                    <button className="p-2.5 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors relative">
                        <Bell className="w-5 h-5" />
                        <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-rose-500 rounded-full border-2 border-white dark:border-slate-900" />
                    </button>

                    <button className="p-2.5 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        <Settings className="w-5 h-5" />
                    </button>
                </div>

                {/* Profile */}
                <div className="group relative">
                    <button className="flex items-center gap-3 p-1.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-white/10">
                        <div className="w-9 h-9 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
                            <UserIcon className="w-5 h-5" />
                        </div>
                        <div className="hidden lg:block text-left">
                            <p className="text-xs font-black text-slate-900 dark:text-white truncate max-w-[100px] leading-tight">{user?.email?.split('@')[0] || 'Trader'}</p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter leading-tight">Pro Account</p>
                        </div>
                        <ChevronDown className="w-4 h-4 text-slate-400 group-hover:rotate-180 transition-transform duration-300" />
                    </button>

                    {/* Dropdown Menu */}
                    <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none py-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 z-50">
                        <div className="px-4 py-2 border-b border-slate-100 dark:border-white/5 mb-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/5 transition-colors text-left"
                        >
                            <LogOut className="w-4 h-4" />
                            <span className="font-bold">Logout System</span>
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
