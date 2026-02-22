import { useState, useEffect, useCallback } from 'react'
import {
    Search,
    Filter,
    ChevronLeft,
    ChevronRight,
    TrendingUp,
    TrendingDown,
    Calendar,
    Clock,
    Target
} from 'lucide-react'
import { apiGet } from '../../trading'
import StrategyPlaceholderLayout from '../StrategiesPage/StrategyPlaceholderLayout'

type Trade = {
    _id: string
    strategyId: {
        _id: string
        name: string
    }
    index: string
    premium: number
    qty: number
    buyPrice: number
    exitPrice?: number
    pnl?: number
    exitReason?: string
    createdAt: string
}

type TradesResponse = {
    status: string
    results: number
    total: number
    pages: number
    data: {
        trades: Trade[]
    }
}

export default function TradesPage() {
    const [trades, setTrades] = useState<Trade[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [totalResults, setTotalResults] = useState(0)

    // Filters
    const [strategyFilter, setStrategyFilter] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')

    const fetchTrades = useCallback(async () => {
        setLoading(true)
        try {
            let url = `/trades?page=${page}&limit=10`
            if (strategyFilter) url += `&strategyId=${strategyFilter}`
            if (startDate) url += `&startDate=${startDate}`
            if (endDate) url += `&endDate=${endDate}`

            const response = await apiGet<TradesResponse>(url)
            if (response.status === 'success') {
                setTrades(response.data.trades)
                setTotalPages(response.pages)
                setTotalResults(response.total)
            }
        } catch (error) {
            console.error('Error fetching trades:', error)
        } finally {
            setLoading(false)
        }
    }, [page, strategyFilter, startDate, endDate])

    useEffect(() => {
        fetchTrades()
    }, [fetchTrades])

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    return (
        <StrategyPlaceholderLayout title="Trade Ledger">
            <div className="space-y-6">
                {/* Filters Panel */}
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-6 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-8 opacity-[0.02] pointer-events-none">
                        <Target className="w-48 h-48 rotate-12" />
                    </div>
                    <div className="flex flex-col md:flex-row gap-4 relative z-10">
                        <div className="flex-1 relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by Strategy ID..."
                                className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-12 pr-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black"
                                value={strategyFilter}
                                onChange={(e) => setStrategyFilter(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-4">
                            <div className="relative">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="date"
                                    className="bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-12 pr-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black flex-1"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div className="relative">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="date"
                                    className="bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-12 pr-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black flex-1"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        </div>
                        <button
                            onClick={() => { setStrategyFilter(''); setStartDate(''); setEndDate(''); setPage(1); }}
                            className="px-6 py-3 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400 text-xs font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 flex items-center gap-2"
                        >
                            <Filter className="w-4 h-4" />
                            Reset
                        </button>
                    </div>
                </div>

                {/* Table Content */}
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-white/5">
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Timestamp</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Strategy</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Asset</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Qty</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Entry</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Exit</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Total PNL</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                {loading ? (
                                    <tr>
                                        <td colSpan={8} className="px-8 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                                                <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Synchronizing Ledger...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : trades.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-8 py-20 text-center">
                                            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No transaction records found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    trades.map((trade) => (
                                        <tr key={trade._id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-3">
                                                    <Clock className="w-4 h-4 text-slate-400" />
                                                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                                        {formatDate(trade.createdAt)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <span className="px-3 py-1 bg-cyan-500/10 text-cyan-500 text-[10px] font-black uppercase tracking-widest rounded-lg">
                                                    {trade.strategyId?.name || 'Manual'}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5">
                                                <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                                                    {trade.index}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                                    {trade.qty}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                                                    ₹{trade.buyPrice.toFixed(2)}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight">
                                                    {trade.exitPrice ? `₹${trade.exitPrice.toFixed(2)}` : '---'}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className={`flex items-center justify-end gap-2 text-sm font-black tracking-tight ${trade.pnl && trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {trade.pnl && trade.pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : (trade.pnl ? <TrendingDown className="w-3 h-3" /> : null)}
                                                    {trade.pnl ? `₹${trade.pnl.toFixed(2)}` : '---'}
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <span className={`text-[10px] font-black uppercase tracking-widest ${trade.exitReason === 'Target' ? 'text-emerald-500' : trade.exitReason === 'SL' ? 'text-rose-500' : 'text-slate-400'}`}>
                                                    {trade.exitReason || 'Active'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="px-8 py-6 border-t border-slate-100 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            Displaying <span className="text-slate-900 dark:text-white">{trades.length}</span> of <span className="text-slate-900 dark:text-white">{totalResults}</span> Records
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                disabled={page === 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="w-10 h-10 flex items-center justify-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl disabled:opacity-30 hover:border-cyan-500/50 transition-all active:scale-95"
                            >
                                <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </button>
                            <div className="flex items-center gap-1">
                                {[...Array(totalPages)].map((_, i) => (
                                    <button
                                        key={i + 1}
                                        onClick={() => setPage(i + 1)}
                                        className={`w-10 h-10 text-[10px] font-black rounded-xl transition-all ${page === i + 1 ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'bg-slate-50 dark:bg-white/5 text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {i + 1}
                                    </button>
                                ))}
                            </div>
                            <button
                                disabled={page === totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                className="w-10 h-10 flex items-center justify-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl disabled:opacity-30 hover:border-cyan-500/50 transition-all active:scale-95"
                            >
                                <ChevronRight className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </StrategyPlaceholderLayout>
    )
}
