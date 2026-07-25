import { useEffect, useState } from 'react'
import {
    Activity,
    ShieldAlert,
    Target,
    ChevronRight,
    Play,
    Square,
    XCircle
} from 'lucide-react'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import { apiGet, apiPost } from '../../trading'
import { usePageTitle } from '../../hooks/usePageTitle'

type Underlying = 'SENSEX' | 'NIFTY' | 'BANKNIFTY' | 'CRUDEOILM'
type Exchange = 'BFO' | 'NFO' | 'MCX'

const INDEX_CONFIG: Record<Underlying, { qty: number, step: number, exchange: Exchange }> = {
    SENSEX: { qty: 20, step: 20, exchange: 'BFO' },
    NIFTY: { qty: 65, step: 65, exchange: 'NFO' },
    BANKNIFTY: { qty: 30, step: 30, exchange: 'NFO' },
    CRUDEOILM: { qty: 1, step: 1, exchange: 'MCX' },
}

type StrategyState = 'WAITING' | 'SCANNING' | 'IN_POSITION' | 'COOLDOWN' | 'STOPPED'
type Trend = 'BULLISH' | 'BEARISH' | 'NEUTRAL'
type StrikeMode = 'ATM' | 'ITM' | 'OTM'
type ExitStrategy = 'CANDLES' | 'TARGET'

const TIMEFRAME_OPTIONS = [
    { label: '1m', value: 'ONE_MINUTE' },
    { label: '3m', value: 'THREE_MINUTE' },
    { label: '5m', value: 'FIVE_MINUTE' },
    { label: '15m', value: 'FIFTEEN_MINUTE' },
    { label: '30m', value: 'THIRTY_MINUTE' },
]

function getSavedState<T>(key: string, fallback: T): T {
    try {
        const item = localStorage.getItem(key)
        if (item === null) return fallback
        try {
            return JSON.parse(item) as T
        } catch {
            return item as unknown as T
        }
    } catch {
        return fallback
    }
}

export default function HeikenashiPage() {
    usePageTitle('Heikenashi')
    const { connectStatus } = useAngelConnection()

    const [isRunning, setIsRunning] = useState<boolean>(() => getSavedState('ha_isRunning', false))
    const [state, setState] = useState<StrategyState>(() => getSavedState('ha_state', 'STOPPED'))
    const [message, setMessage] = useState<string>('')
    const [trend, setTrend] = useState<Trend>('NEUTRAL')

    // Core Configuration
    const [underlying, setUnderlying] = useState<Underlying>(() => getSavedState('ha_underlying', 'SENSEX'))
    const [quantity, setQuantity] = useState<number>(() => getSavedState('ha_quantity', INDEX_CONFIG.SENSEX.qty))
    const [baseTimeframe, setBaseTimeframe] = useState<string>(() => getSavedState('ha_baseTimeframe', 'FIVE_MINUTE'))
    const [needConfirmation, setNeedConfirmation] = useState<boolean>(() => getSavedState('ha_needConfirmation', false))
    const [confirmationTimeframe, setConfirmationTimeframe] = useState<string>(() => getSavedState('ha_confirmationTimeframe', 'FIFTEEN_MINUTE'))

    // Strike Selection
    const [strikeMode, setStrikeMode] = useState<StrikeMode>(() => getSavedState('ha_strikeMode', 'ATM'))
    const [strikeDepth, setStrikeDepth] = useState<number>(() => getSavedState('ha_strikeDepth', 1))
    const [premiumMin, setPremiumMin] = useState<number>(() => getSavedState('ha_premiumMin', 300))
    const [premiumMax, setPremiumMax] = useState<number>(() => getSavedState('ha_premiumMax', 400))

    // Exit Strategy Configuration
    const [exitStrategy, setExitStrategy] = useState<ExitStrategy>(() => getSavedState('ha_exitStrategy', 'CANDLES'))
    const [targetPoints, setTargetPoints] = useState<number>(() => getSavedState('ha_targetPoints', 20))
    const [slPoints, setSlPoints] = useState<number>(() => getSavedState('ha_slPoints', 30))
    const [liveTradingConsent, setLiveTradingConsent] = useState<boolean>(() => getSavedState('ha_liveTradingConsent', false))

    // Dynamic Live Monitor States from Backend Status
    const [monitoredPremiums, setMonitoredPremiums] = useState<{ ce: string, pe: string }>({ ce: '---', pe: '---' })
    const [checkpoints, setCheckpoints] = useState([
        { id: 'broker', label: 'Broker Connection', status: 'pending' },
        { id: 'expiry', label: 'Next Expiry Locked', status: 'pending' },
        { id: 'ha_trend', label: 'HA Trend Stability', status: 'pending' },
        { id: 'confirmation', label: 'Timeframe Sync', status: 'pending' },
        { id: 'indicators', label: 'EMA/JMA Cross Check', status: 'pending' }
    ])

    const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
    const [activeTradePremium, setActiveTradePremium] = useState<string | null>(null)
    const [entryPrice, setEntryPrice] = useState<number | null>(null)
    const [currentLtp, setCurrentLtp] = useState<number | null>(null)
    const [isExiting, setIsExiting] = useState<boolean>(false)

    // Local Storage Sync
    useEffect(() => {
        localStorage.setItem('ha_isRunning', JSON.stringify(isRunning))
        localStorage.setItem('ha_state', JSON.stringify(state))
        localStorage.setItem('ha_underlying', JSON.stringify(underlying))
        localStorage.setItem('ha_quantity', JSON.stringify(quantity))
        localStorage.setItem('ha_baseTimeframe', JSON.stringify(baseTimeframe))
        localStorage.setItem('ha_needConfirmation', JSON.stringify(needConfirmation))
        localStorage.setItem('ha_confirmationTimeframe', JSON.stringify(confirmationTimeframe))
        localStorage.setItem('ha_strikeMode', JSON.stringify(strikeMode))
        localStorage.setItem('ha_strikeDepth', JSON.stringify(strikeDepth))
        localStorage.setItem('ha_premiumMin', JSON.stringify(premiumMin))
        localStorage.setItem('ha_premiumMax', JSON.stringify(premiumMax))
        localStorage.setItem('ha_exitStrategy', JSON.stringify(exitStrategy))
        localStorage.setItem('ha_targetPoints', JSON.stringify(targetPoints))
        localStorage.setItem('ha_slPoints', JSON.stringify(slPoints))
        localStorage.setItem('ha_liveTradingConsent', JSON.stringify(liveTradingConsent))
    }, [isRunning, state, underlying, quantity, baseTimeframe, needConfirmation, confirmationTimeframe, strikeMode, strikeDepth, premiumMin, premiumMax, exitStrategy, targetPoints, slPoints, liveTradingConsent])

    // Poll Strategy Status from Backend Engine
    useEffect(() => {
        let active = true

        const fetchStatus = async () => {
            try {
                const res = await apiGet<{
                    data: {
                        isRunning: boolean
                        state: StrategyState
                        message: string
                        trend: Trend
                        monitoredPremiums: { ce: string, pe: string }
                        checkpoints: Array<{ id: string, label: string, status: string }>
                        activeTradeId: string | null
                        activeTradePremium: string | null
                        entryPrice: number | null
                        currentLtp: number | null
                    }
                }>('/strategies/HeikenAshi/status')

                if (!active || !res.data) return

                const d = res.data
                setIsRunning(d.isRunning)
                setState(d.state)
                if (d.message) setMessage(d.message)
                setTrend(d.trend)
                if (d.monitoredPremiums) setMonitoredPremiums(d.monitoredPremiums)
                if (d.checkpoints) setCheckpoints(d.checkpoints)
                setActiveTradeId(d.activeTradeId)
                setActiveTradePremium(d.activeTradePremium)
                setEntryPrice(d.entryPrice)
                setCurrentLtp(d.currentLtp)
            } catch (err) {
                // Ignore network status errors when backend is offline
            }
        }

        fetchStatus()
        const interval = setInterval(fetchStatus, 1500)
        return () => {
            active = false
            clearInterval(interval)
        }
    }, [])

    const handleUnderlyingChange = (val: Underlying) => {
        setUnderlying(val)
        setQuantity(INDEX_CONFIG[val].qty)
    }

    const startStrategy = async () => {
        try {
            setMessage('Launching algorithm on backend engine...')
            const payload = {
                underlying,
                quantity,
                baseTimeframe,
                needConfirmation,
                confirmationTimeframe,
                strikeMode,
                strikeDepth,
                premiumMin,
                premiumMax,
                exitStrategy,
                targetPoints,
                slPoints,
                liveTradingConsent
            }
            await apiPost('/strategies/HeikenAshi/start', payload)
            setIsRunning(true)
            setState('SCANNING')
        } catch (err) {
            console.error('Failed to start strategy:', err)
            setMessage('Failed to launch strategy on backend engine.')
        }
    }

    const stopStrategy = async () => {
        try {
            setMessage('Halting algorithm on backend engine...')
            await apiPost('/strategies/HeikenAshi/stop')
            setIsRunning(false)
            setState('STOPPED')
            setTrend('NEUTRAL')
            setActiveTradeId(null)
            setActiveTradePremium(null)
            setEntryPrice(null)
            setCurrentLtp(null)
        } catch (err) {
            console.error('Failed to stop strategy:', err)
        }
    }

    const manualExitPosition = async () => {
        if (isExiting) return
        setIsExiting(true)
        setMessage('Manual exit initiated...')
        try {
            await apiPost('/strategies/HeikenAshi/exit')
        } catch (err) {
            console.error('Failed to exit position:', err)
        } finally {
            setIsExiting(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-12">
            {/* Status Panel */}
            <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50' : 'bg-slate-300'}`} />
                            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Control Center</h2>
                        </div>
                        <p className="text-sm font-medium text-slate-500 max-w-md">
                            {message || 'Ready to monitor market volatility and execution signals.'}
                        </p>
                        <div className="flex items-center gap-8 pt-2">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Current state</p>
                                <p className="text-sm font-black text-slate-700 dark:text-slate-200">{state}</p>
                            </div>
                            <div className="h-8 w-px bg-slate-100 dark:bg-white/5" />
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">HA Trend</p>
                                <p className={`text-sm font-black ${trend === 'BULLISH' ? 'text-emerald-500' : trend === 'BEARISH' ? 'text-rose-500' : 'text-slate-400'}`}>
                                    {trend}
                                </p>
                            </div>
                            {activeTradePremium && (
                                <>
                                    <div className="h-8 w-px bg-slate-100 dark:bg-white/5" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Active Premium</p>
                                        <p className="text-sm font-black text-cyan-500">{activeTradePremium}</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {!isRunning ? (
                            <button
                                onClick={startStrategy}
                                disabled={connectStatus !== 'connected'}
                                className="flex items-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
                            >
                                <Play className="w-4 h-4 fill-current" />
                                Launch Algorithm
                            </button>
                        ) : (
                            <button
                                onClick={stopStrategy}
                                className="flex items-center gap-2 px-8 py-4 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-rose-500/20 active:scale-95"
                            >
                                <Square className="w-4 h-4 fill-current" />
                                Terminate Session
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Configuration Area */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-8">
                        <h3 className="text-[10px] items-center gap-2 font-black uppercase tracking-[0.2em] text-cyan-500 mb-8 flex">
                            <Activity className="w-4 h-4" />
                            Execution Parameters
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Instrument</label>
                                    <select
                                        value={underlying}
                                        onChange={(e) => handleUnderlyingChange(e.target.value as Underlying)}
                                        disabled={isRunning}
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <option value="SENSEX">SENSEX (BSE)</option>
                                        <option value="NIFTY">NIFTY (NSE)</option>
                                        <option value="BANKNIFTY">BANKNIFTY (NSE)</option>
                                        <option value="CRUDEOILM">CRUDEOILM (MCX)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Quantity</label>
                                    <input
                                        type="number"
                                        value={quantity}
                                        step={INDEX_CONFIG[underlying].step}
                                        onChange={(e) => setQuantity(Number(e.target.value))}
                                        disabled={isRunning}
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Scan Timeframe</label>
                                    <select
                                        value={baseTimeframe}
                                        onChange={(e) => setBaseTimeframe(e.target.value)}
                                        disabled={isRunning}
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {TIMEFRAME_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="pt-2">
                                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all">
                                        <div className="flex items-center gap-3">
                                            <ShieldAlert className="w-5 h-5 text-cyan-500" />
                                            <div>
                                                <p className="text-xs font-black text-slate-900 dark:text-white">Trend Confirmation</p>
                                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Dual-frame validation</p>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={needConfirmation}
                                                onChange={(e) => setNeedConfirmation(e.target.checked)}
                                                disabled={isRunning}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                                        </label>
                                    </div>

                                    {needConfirmation && (
                                        <div className="mt-4 animate-in slide-in-from-top-2 duration-300">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Confirmation Timeframe</label>
                                            <select
                                                value={confirmationTimeframe}
                                                onChange={(e) => setConfirmationTimeframe(e.target.value)}
                                                disabled={isRunning}
                                                className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {TIMEFRAME_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="mt-8 flex items-center justify-between p-6 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl group hover:border-cyan-500/50 transition-all duration-500">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-500 ${liveTradingConsent ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'bg-slate-200 dark:bg-white/5 text-slate-400'}`}>
                                    <Activity className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">Live Execution</p>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Authorize real-time order placement</p>
                                </div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={liveTradingConsent}
                                    onChange={(e) => setLiveTradingConsent(e.target.checked)}
                                    disabled={isRunning}
                                    className="sr-only peer"
                                />
                                <div className="w-14 h-7 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-rose-500 shadow-inner"></div>
                            </label>
                        </div>

                        {state !== 'STOPPED' && (
                            <div className="mt-6 bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm animate-in zoom-in duration-300">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-500">Live Trade Metrics</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping" />
                                        <span className="text-[10px] font-black text-slate-400">Monitoring Active Position</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Premium LTP</p>
                                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
                                            ₹{currentLtp?.toFixed(2) || '---'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Entry Price</p>
                                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
                                            ₹{entryPrice?.toFixed(2) || '---'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">P&amp;L</p>
                                        <p className={`text-xl font-black mt-1 ${currentLtp && entryPrice
                                            ? currentLtp >= entryPrice ? 'text-emerald-500' : 'text-rose-500'
                                            : 'text-slate-400'
                                            }`}>
                                            {currentLtp && entryPrice
                                                ? `₹${((currentLtp - entryPrice) * quantity).toFixed(2)}`
                                                : '---'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Strategy Trend</p>
                                        <p className={`text-xl font-black mt-1 ${trend === 'BULLISH' ? 'text-emerald-500' : trend === 'BEARISH' ? 'text-rose-500' : 'text-slate-400'}`}>
                                            {trend}
                                        </p>
                                    </div>
                                </div>

                                {state === 'IN_POSITION' && activeTradeId && (
                                    <div className="mt-6 pt-6 border-t border-slate-100 dark:border-white/5 flex justify-end">
                                        <button
                                            onClick={manualExitPosition}
                                            disabled={isExiting}
                                            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-amber-500/20 active:scale-95"
                                        >
                                            <XCircle className="w-4 h-4" />
                                            {isExiting ? 'Exiting...' : 'Exit Position'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Side Panels */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-8">
                        <h3 className="text-[10px] items-center gap-2 font-black uppercase tracking-[0.2em] text-slate-400 mb-8 flex">
                            <Target className="w-4 h-4" />
                            Strike Selection
                        </h3>

                        <div className="space-y-6">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Strike Preference</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['ITM', 'ATM', 'OTM'] as StrikeMode[]).map((mode) => (
                                        <button
                                            key={mode}
                                            onClick={() => setStrikeMode(mode)}
                                            disabled={isRunning}
                                            className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${strikeMode === mode
                                                ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                                                : isRunning
                                                    ? 'bg-slate-50 dark:bg-white/5 text-slate-400 opacity-50 cursor-not-allowed'
                                                    : 'bg-slate-50 dark:bg-white/5 text-slate-400 hover:text-slate-600'
                                                }`}
                                        >
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {strikeMode !== 'ATM' && (
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Strike Depth</label>
                                    <div className="flex items-center justify-between p-1 bg-slate-50 dark:bg-white/5 rounded-xl">
                                        <button
                                            onClick={() => setStrikeDepth(Math.max(1, strikeDepth - 1))}
                                            disabled={isRunning}
                                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-cyan-500 font-black text-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                        >-</button>
                                        <span className={`text-sm font-black ${isRunning ? 'text-slate-400' : 'text-slate-900 dark:text-white'}`}>{strikeDepth}</span>
                                        <button
                                            onClick={() => setStrikeDepth(strikeDepth + 1)}
                                            disabled={isRunning}
                                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-cyan-500 font-black text-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                        >+</button>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Premium Range</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        value={premiumMin}
                                        onChange={(e) => setPremiumMin(Number(e.target.value))}
                                        disabled={isRunning}
                                        placeholder="Min"
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <ChevronRight className="w-4 h-4 text-slate-300" />
                                    <input
                                        type="number"
                                        value={premiumMax}
                                        onChange={(e) => setPremiumMax(Number(e.target.value))}
                                        disabled={isRunning}
                                        placeholder="Max"
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Exit Strategy</label>
                                <div className="space-y-3">
                                    <label className={`flex items-center gap-3 ${isRunning ? 'cursor-not-allowed opacity-50' : 'cursor-pointer group'}`} onClick={() => !isRunning && setExitStrategy('CANDLES')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${exitStrategy === 'CANDLES' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-300 dark:border-white/20'}`}>
                                            <div className={`w-2.5 h-2.5 rounded-full bg-cyan-500 transition-all ${exitStrategy === 'CANDLES' ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`} />
                                        </div>
                                        <span className={`text-sm font-bold transition-all ${exitStrategy === 'CANDLES' ? 'text-cyan-500' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                                            2 Consecutive Red Candles
                                        </span>
                                    </label>
                                    <label className={`flex items-center gap-3 ${isRunning ? 'cursor-not-allowed opacity-50' : 'cursor-pointer group'}`} onClick={() => !isRunning && setExitStrategy('TARGET')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${exitStrategy === 'TARGET' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-300 dark:border-white/20'}`}>
                                            <div className={`w-2.5 h-2.5 rounded-full bg-cyan-500 transition-all ${exitStrategy === 'TARGET' ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`} />
                                        </div>
                                        <span className={`text-sm font-bold transition-all ${exitStrategy === 'TARGET' ? 'text-cyan-500' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                                            Target Points
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {exitStrategy === 'TARGET' && (
                                <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Points to Target</label>
                                        <input
                                            type="number"
                                            value={targetPoints}
                                            onChange={(e) => setTargetPoints(parseFloat(e.target.value) || 0)}
                                            disabled={isRunning}
                                            placeholder="e.g. 20"
                                            className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Stop Loss Points</label>
                                        <input
                                            type="number"
                                            value={slPoints}
                                            onChange={(e) => setSlPoints(parseFloat(e.target.value) || 0)}
                                            disabled={isRunning}
                                            placeholder="e.g. 30"
                                            className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            </div>

            {/* Live Monitor Panel */}
            <div className="bg-slate-900 rounded-[2rem] border border-white/5 shadow-2xl p-8 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform duration-700">
                    <Activity className="w-64 h-64 text-cyan-500" />
                </div>

                <div className="relative z-10 flex flex-col lg:flex-row gap-12">
                    <div className="flex-1 space-y-8">
                        <div>
                            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                                Live Strategy Monitor
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className={`border rounded-2xl p-6 backdrop-blur-xl transition-all ${activeTradePremium === monitoredPremiums.ce && monitoredPremiums.ce !== '---'
                                    ? 'bg-cyan-500/20 border-cyan-500/40'
                                    : 'bg-white/5 border-white/10'
                                    }`}>
                                    <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-1">Analyzed CE</p>
                                    {activeTradePremium === monitoredPremiums.ce && monitoredPremiums.ce !== '---' && (
                                        <p className="text-[9px] font-black text-cyan-400 uppercase tracking-widest mb-2">● ACTIVE TRADE</p>
                                    )}
                                    <p className="text-xl font-black text-white">{monitoredPremiums.ce}</p>
                                </div>
                                <div className={`border rounded-2xl p-6 backdrop-blur-xl transition-all ${activeTradePremium === monitoredPremiums.pe && monitoredPremiums.pe !== '---'
                                    ? 'bg-rose-500/20 border-rose-500/40'
                                    : 'bg-white/5 border-white/10'
                                    }`}>
                                    <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Analyzed PE</p>
                                    {activeTradePremium === monitoredPremiums.pe && monitoredPremiums.pe !== '---' && (
                                        <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-2">● ACTIVE TRADE</p>
                                    )}
                                    <p className="text-xl font-black text-white">{monitoredPremiums.pe}</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Active Checkpoints</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {checkpoints.map(cp => (
                                    <div key={cp.id} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                                        <div className={`w-2 h-2 rounded-full ${cp.status === 'success'
                                            ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50'
                                            : cp.status === 'error'
                                                ? 'bg-rose-500'
                                                : 'bg-white/20'
                                            }`} />
                                        <span className="text-[11px] font-bold text-white/60 uppercase">{cp.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}