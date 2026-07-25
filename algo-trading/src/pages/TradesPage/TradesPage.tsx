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
    Target,
    RefreshCw,
    ChevronDown,
    Check
} from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { apiGet } from '../../trading'
import { buildTradesUrl } from './tradesQuery'
import { usePageTitle } from '../../hooks/usePageTitle'

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
    analytics?: {
        totalPnl: number
        totalTrades: number
        taxes: number
        netPnl: number
    }
    data: {
        trades: Trade[]
    }
}

export default function TradesPage() {
    usePageTitle('Trades');
    const [trades, setTrades] = useState<Trade[]>([])
    const [strategies, setStrategies] = useState<{ _id: string, name: string }[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [totalResults, setTotalResults] = useState(0)

    // Filters inputs
    const [searchQuery, setSearchQuery] = useState('')
    const [exitReasonFilter, setExitReasonFilter] = useState('')
    const [strategyIdFilter, setStrategyIdFilter] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [timeFrom, setTimeFrom] = useState('')
    const [timeTo, setTimeTo] = useState('')

    // Applied Filters (used for fetching)
    const [appliedFilters, setAppliedFilters] = useState({
        searchQuery: '',
        exitReasonFilter: '',
        strategyIdFilter: '',
        startDate: '',
        endDate: '',
        timeFrom: '',
        timeTo: ''
    })

    // Custom Select Dropdown states
    const [isStrategyDropdownOpen, setIsStrategyDropdownOpen] = useState(false)
    const [isExitReasonDropdownOpen, setIsExitReasonDropdownOpen] = useState(false)

    const [analytics, setAnalytics] = useState({
        totalPnl: 0,
        totalTrades: 0,
        taxes: 0,
        netPnl: 0
    })

    const fetchTrades = useCallback(async () => {
        setLoading(true)
        try {
            const url = buildTradesUrl({ page, limit: 10, filters: appliedFilters })

            const response = await apiGet<TradesResponse>(url)
            if (response.status === 'success') {
                setTrades(response.data.trades)
                setTotalPages(response.pages)
                setTotalResults(response.total)
                if (response.analytics) {
                    setAnalytics(response.analytics)
                }
            }
        } catch (error) {
            console.error('Error fetching trades:', error)
        } finally {
            setLoading(false)
        }
    }, [page, appliedFilters])

    useEffect(() => {
        fetchTrades()
    }, [fetchTrades])

    useEffect(() => {
        apiGet<{ status: string, data: { strategies: { _id: string, name: string }[] } }>('/strategies')
            .then(res => {
                if (res.status === 'success') {
                    setStrategies(res.data.strategies)
                }
            })
            .catch(console.error)
    }, [])

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
        <div className="space-y-6">
            {/* Filters Panel */}
            <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-6 relative">
                <div className="absolute top-0 right-0 p-8 opacity-[0.02] pointer-events-none">
                    <Target className="w-48 h-48 rotate-12" />
                </div>

                <div className="relative z-10 w-full flex flex-col gap-6">
                    {/* Top Row: Search & Dropdowns */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="relative md:col-span-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by Index or Premium..."
                                className="w-full h-full bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-12 pr-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Custom Strategy Dropdown */}
                        <div className="relative md:col-span-1">
                            <div
                                className="w-full bg-slate-50 dark:bg-white/5 rounded-2xl px-4 py-3 cursor-pointer flex items-center justify-between text-sm font-black transition-all hover:bg-slate-100 dark:hover:bg-white/10"
                                onClick={() => {
                                    setIsStrategyDropdownOpen(!isStrategyDropdownOpen)
                                    setIsExitReasonDropdownOpen(false)
                                }}
                            >
                                <span className={strategyIdFilter ? 'text-cyan-500' : 'text-slate-500 dark:text-slate-400'}>
                                    {strategyIdFilter ? strategies.find(s => s._id === strategyIdFilter)?.name || 'Unknown Strategy' : 'All Strategies'}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isStrategyDropdownOpen ? 'rotate-180' : ''}`} />
                            </div>

                            {isStrategyDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-[100]" onClick={() => setIsStrategyDropdownOpen(false)} />
                                    <div className="absolute top-[105%] -mt-1 left-0 w-full z-[110] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none py-2 animate-in fade-in slide-in-from-top-1">
                                        <div
                                            className={`px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm font-black flex items-center justify-between transition-colors ${!strategyIdFilter ? 'text-slate-900 dark:text-white bg-slate-50/50 dark:bg-slate-700/20' : 'text-slate-500 dark:text-slate-400'}`}
                                            onClick={() => {
                                                setStrategyIdFilter('');
                                                setIsStrategyDropdownOpen(false);
                                            }}
                                        >
                                            All Strategies
                                            {!strategyIdFilter && <Check className="w-4 h-4 text-cyan-500" />}
                                        </div>
                                        {strategies.map(s => (
                                            <div
                                                key={s._id}
                                                className={`px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm font-black flex items-center justify-between transition-colors ${strategyIdFilter === s._id ? 'text-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' : 'text-slate-600 dark:text-slate-300'}`}
                                                onClick={() => {
                                                    setStrategyIdFilter(s._id);
                                                    setIsStrategyDropdownOpen(false);
                                                }}
                                            >
                                                {s.name}
                                                {strategyIdFilter === s._id && <Check className="w-4 h-4 text-cyan-500" />}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Custom Exit Reason Dropdown */}
                        <div className="relative md:col-span-1">
                            <div
                                className="w-full bg-slate-50 dark:bg-white/5 rounded-2xl px-4 py-3 cursor-pointer flex items-center justify-between text-sm font-black transition-all hover:bg-slate-100 dark:hover:bg-white/10"
                                onClick={() => {
                                    setIsExitReasonDropdownOpen(!isExitReasonDropdownOpen)
                                    setIsStrategyDropdownOpen(false)
                                }}
                            >
                                <span className={exitReasonFilter ? 'text-cyan-500' : 'text-slate-500 dark:text-slate-400'}>
                                    {exitReasonFilter || 'All Exit Reasons'}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExitReasonDropdownOpen ? 'rotate-180' : ''}`} />
                            </div>

                            {isExitReasonDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-[100]" onClick={() => setIsExitReasonDropdownOpen(false)} />
                                    <div className="absolute top-[105%] -mt-1 left-0 w-full z-[110] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none py-2 animate-in fade-in slide-in-from-top-1">
                                        {[
                                            { value: '', label: 'All Exit Reasons' },
                                            { value: 'Target', label: 'Target' },
                                            { value: 'SL', label: 'SL' },
                                            { value: 'Trailing SL', label: 'Trailing SL' },
                                            { value: 'Strategy', label: 'Strategy' },
                                            { value: 'HA_TREND_REVERSAL', label: 'HA_TREND_REVERSAL' }
                                        ].map(option => (
                                            <div
                                                key={option.value}
                                                className={`px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm font-black flex items-center justify-between transition-colors ${exitReasonFilter === option.value ? 'text-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' : (option.value === '' ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300')}`}
                                                onClick={() => {
                                                    setExitReasonFilter(option.value);
                                                    setIsExitReasonDropdownOpen(false);
                                                }}
                                            >
                                                {option.label}
                                                {exitReasonFilter === option.value && <Check className="w-4 h-4 text-cyan-500" />}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Bottom Row: Date/Time Pickers & Actions */}
                    <div className="flex flex-col xl:flex-row gap-4 justify-between items-center">
                        {/* Time & Date Range */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full xl:w-auto">
                            <div className="relative">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                                <DatePicker
                                    selected={startDate ? new Date(startDate) : null}
                                    onChange={(date: Date | null) => {
                                        if (date) {
                                            const offset = date.getTimezoneOffset()
                                            const localDate = new Date(date.getTime() - (offset * 60 * 1000))
                                            setStartDate(localDate.toISOString().split('T')[0])
                                        } else {
                                            setStartDate('')
                                        }
                                    }}
                                    dateFormat="yyyy-MM-dd"
                                    placeholderText="Start Date"
                                    className="bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-10 pr-2 py-3 text-xs md:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black w-full"
                                />
                            </div>
                            <div className="relative">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                                <DatePicker
                                    selected={endDate ? new Date(endDate) : null}
                                    onChange={(date: Date | null) => {
                                        if (date) {
                                            const offset = date.getTimezoneOffset()
                                            const localDate = new Date(date.getTime() - (offset * 60 * 1000))
                                            setEndDate(localDate.toISOString().split('T')[0])
                                        } else {
                                            setEndDate('')
                                        }
                                    }}
                                    dateFormat="yyyy-MM-dd"
                                    placeholderText="End Date"
                                    className="bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-10 pr-2 py-3 text-xs md:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black w-full"
                                />
                            </div>
                            <div className="relative z-[90]">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                                <input
                                    type="time"
                                    value={timeFrom}
                                    onChange={(e) => setTimeFrom(e.target.value)}
                                    className="bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-10 pr-2 py-3 text-xs md:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black w-full dark:[color-scheme:dark]"
                                />
                            </div>
                            <div className="relative z-[90]">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                                <input
                                    type="time"
                                    value={timeTo}
                                    onChange={(e) => setTimeTo(e.target.value)}
                                    className="bg-slate-50 dark:bg-white/5 border-none rounded-2xl pl-10 pr-2 py-3 text-xs md:text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black w-full dark:[color-scheme:dark]"
                                />
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex w-full xl:w-auto items-center gap-3">
                            <button
                                onClick={() => {
                                    setPage(1)
                                    setAppliedFilters({
                                        searchQuery,
                                        exitReasonFilter,
                                        strategyIdFilter,
                                        startDate,
                                        endDate,
                                        timeFrom,
                                        timeTo
                                    })
                                }}
                                className="flex-1 xl:flex-none px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-cyan-500/20 active:scale-95 flex items-center justify-center gap-2"
                            >
                                <Filter className="w-4 h-4 fill-current" />
                                Apply
                            </button>
                            <button
                                onClick={() => {
                                    setSearchQuery('')
                                    setExitReasonFilter('')
                                    setStrategyIdFilter('')
                                    setStartDate('')
                                    setEndDate('')
                                    setTimeFrom('')
                                    setTimeTo('')
                                    setPage(1)
                                    setAppliedFilters({ searchQuery: '', exitReasonFilter: '', strategyIdFilter: '', startDate: '', endDate: '', timeFrom: '', timeTo: '' })
                                }}
                                className="flex-1 xl:flex-none px-6 py-3 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400 text-xs font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                <Filter className="w-4 h-4" />
                                Reset
                            </button>
                            <button
                                onClick={() => fetchTrades()}
                                className="px-4 py-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-500 text-xs font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 flex items-center justify-center"
                                title="Refresh"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Analytics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-6 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none">
                        <TrendingUp className="w-24 h-24 rotate-12" />
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Total PNL</p>
                    <div className={`flex items-baseline gap-2 ${analytics.totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        <span className="text-3xl font-black tracking-tighter">₹{Math.abs(analytics.totalPnl).toFixed(2)}</span>
                        {analytics.totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    </div>
                </div>

                {/* Win Rate Card */}
                {(() => {
                    const completedTrades = trades.filter((t) => t.pnl !== undefined);
                    const winningTrades = completedTrades.filter((t) => (t.pnl || 0) > 0);
                    const winRate = completedTrades.length > 0
                        ? ((winningTrades.length / completedTrades.length) * 100).toFixed(1)
                        : '0.0';
                    return (
                        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-6 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-6 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none">
                                <Target className="w-24 h-24 rotate-12" />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Win Rate</p>
                            <div className="text-3xl font-black tracking-tighter text-emerald-500">
                                {winRate}%
                            </div>
                        </div>
                    );
                })()}

                <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-6 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none">
                        <Filter className="w-24 h-24 rotate-12" />
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Est. Taxes & Fees</p>
                    <div className="text-3xl font-black tracking-tighter text-rose-500">
                        ₹{analytics.taxes.toFixed(2)}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-6 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity pointer-events-none">
                        <TrendingUp className="w-24 h-24 rotate-12" />
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Net PNL</p>
                    <div className={`flex items-baseline gap-2 ${analytics.netPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        <span className="text-3xl font-black tracking-tighter">₹{Math.abs(analytics.netPnl).toFixed(2)}</span>
                        {analytics.netPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    </div>
                </div>
            </div>

            {/* Table Content */}
            <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-100 dark:border-white/5">
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Entry date and time</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Strategy</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Index</th>
                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Premium</th>
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
                                    <td colSpan={9} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
                                            <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Synchronizing Ledger...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : trades.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-8 py-20 text-center">
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
                                        <td className="px-8 py-5">
                                            <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                                                {trade.premium}
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
                                            <div className={`flex items-center justify-end gap-2 text-sm font-black tracking-tight ${trade.pnl !== undefined ? (trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-400'}`}>
                                                {trade.pnl !== undefined ? (trade.pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />) : null}
                                                {trade.pnl !== undefined ? `₹${trade.pnl.toFixed(2)}` : '---'}
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
                            {(() => {
                                const pages: (number | string)[] = [];
                                if (totalPages <= 5) {
                                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                                } else {
                                    if (page <= 3) {
                                        pages.push(1, 2, 3, 4, '...', totalPages - 1, totalPages);
                                    } else if (page >= totalPages - 2) {
                                        pages.push(1, 2, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
                                    } else {
                                        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
                                    }
                                }
                                return pages.map((p, i) => (
                                    p === '...' ? (
                                        <span key={`ellipsis-${i}`} className="w-10 h-10 flex items-center justify-center text-slate-400 font-black">
                                            ...
                                        </span>
                                    ) : (
                                        <button
                                            key={`page-${p}`}
                                            onClick={() => setPage(p as number)}
                                            className={`w-10 h-10 text-[10px] font-black rounded-xl transition-all ${page === p ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'bg-slate-50 dark:bg-white/5 text-slate-400 hover:text-slate-600'}`}
                                        >
                                            {p}
                                        </button>
                                    )
                                ));
                            })()}
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
    )
}
