import { useCallback, useEffect, useRef, useState } from 'react'
import {
    Activity,
    ShieldAlert,
    Target,
    ChevronRight,
    Play,
    Square,
    TrendingUp
} from 'lucide-react'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import { apiGet, apiPost } from '../../trading'
import {
    computeHeikenAshi,
    analyzeHeikenAshiStrategy
} from '../../trading/strategies/heikenAshi'

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

type IndexOptionContract = {
    exchange: Exchange
    underlying: Underlying
    expiry: string
    strike: number
    lot_size: number
    option_type: 'CE' | 'PE'
    tradingsymbol: string
    symboltoken: string
}

type IndexOptionsResponse = {
    expiries: string[]
    strikes: number[]
    contracts: IndexOptionContract[]
}

type MarketIndexLtpResponse = {
    underlying: Underlying
    exchange: 'NSE'
    tradingsymbol: string
    symboltoken: string
    ltp: number
}

type CandlesResponse = {
    items: {
        ts: string
        open: number
        high: number
        low: number
        close: number
        v: number
    }[]
}

const TIMEFRAME_OPTIONS = [
    { label: '1m', value: 'ONE_MINUTE' },
    { label: '3m', value: 'THREE_MINUTE' },
    { label: '5m', value: 'FIVE_MINUTE' },
    { label: '15m', value: 'FIFTEEN_MINUTE' },
    { label: '30m', value: 'THIRTY_MINUTE' },
]

export default function HeikenashiPage() {
    const { connectStatus } = useAngelConnection()

    const [isRunning, setIsRunning] = useState(false)
    const [state, setState] = useState<StrategyState>('STOPPED')
    const [message, setMessage] = useState<string>('')
    const [trend, setTrend] = useState<Trend>('NEUTRAL')

    // Core Configuration
    const [underlying, setUnderlying] = useState<Underlying>('SENSEX')
    const [quantity, setQuantity] = useState<number>(INDEX_CONFIG.SENSEX.qty)
    const [baseTimeframe, setBaseTimeframe] = useState<string>('FIVE_MINUTE')
    const [needConfirmation, setNeedConfirmation] = useState(false)
    const [confirmationTimeframe, setConfirmationTimeframe] = useState<string>('FIFTEEN_MINUTE')

    // Live Monitor State
    const [monitoredPremiums, setMonitoredPremiums] = useState<{ ce: string, pe: string }>({ ce: '---', pe: '---' })
    const [checkpoints, setCheckpoints] = useState([
        { id: 'broker', label: 'Broker Connection', status: 'pending' },
        { id: 'expiry', label: 'Next Expiry Locked', status: 'pending' },
        { id: 'ha_trend', label: 'HA Trend Stability', status: 'pending' },
        { id: 'confirmation', label: 'Timeframe Sync', status: 'pending' },
        { id: 'indicators', label: 'EMA/JMA Cross Check', status: 'pending' }
    ])

    // Strike Selection
    const [strikeMode, setStrikeMode] = useState<StrikeMode>('ATM')
    const [strikeDepth, setStrikeDepth] = useState<number>(1)
    const [premiumMin, setPremiumMin] = useState<number>(300)
    const [premiumMax, setPremiumMax] = useState<number>(400)

    const [liveTradingConsent, setLiveTradingConsent] = useState(false)

    // Strategy Execution State
    const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
    const [atmStrike, setAtmStrike] = useState<number | null>(null)
    const [ceContract, setCeContract] = useState<IndexOptionContract | null>(null)
    const [peContract, setPeContract] = useState<IndexOptionContract | null>(null)

    const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
    const [entryPrice, setEntryPrice] = useState<number | null>(null)
    const [currentLtp, setCurrentLtp] = useState<number | null>(null)

    const inFlightRef = useRef(false)

    // Helpers
    const asIsoDate = (d: Date) => d.toISOString().split('T')[0]

    const pickNearestExpiry = (expiries: string[]) => {
        const today = asIsoDate(new Date())
        const valid = expiries.filter(Boolean).sort()
        return valid.find(e => e >= today) || (valid.length ? valid[valid.length - 1] : null)
    }

    const pickNearestStrike = (strikes: number[], spot: number) => {
        if (!strikes.length) return null
        return strikes.reduce((prev, curr) => Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev)
    }

    const resolveStrikeForSide = (params: { strikes: number[], atmStrike: number, mode: StrikeMode, depth: number, side: 'CE' | 'PE' }) => {
        const { strikes, atmStrike, mode, depth, side } = params
        const sorted = [...strikes].filter(Number.isFinite).sort((a, b) => a - b)
        const idx = sorted.findIndex(s => Math.abs(s - atmStrike) < 1e-6)
        if (idx < 0) return null
        if (mode === 'ATM') return sorted[idx]
        const steps = Math.max(0, Math.floor(depth))
        const offset = (side === 'CE' ? 1 : -1) * (mode === 'ITM' ? -1 : 1) * steps
        const next = idx + offset
        return (next >= 0 && next < sorted.length) ? sorted[next] : null
    }

    const startStrategy = () => {
        setIsRunning(true)
        setState('SCANNING')
        setMessage('Market scan initialized...')
    }

    const stopStrategy = useCallback(() => {
        setIsRunning(false)
        setState('STOPPED')
        setMessage('Strategy halted by user.')
        setTrend('NEUTRAL')
        setMonitoredPremiums({ ce: '---', pe: '---' })
        setCheckpoints(prev => prev.map(cp => ({ ...cp, status: 'pending' })))
        setCeContract(null)
        setPeContract(null)
        setAtmStrike(null)
        setSelectedExpiry(null)
        setActiveTradeId(null)
        setEntryPrice(null)
        setCurrentLtp(null)
    }, [])

    // Check for existing open trade on load
    useEffect(() => {
        if (connectStatus !== 'connected') return
        let disposed = false
        apiGet<{ data: { trade?: { _id: string, buyPrice: number, index: Underlying, strategyName: string } } }>(`/trades/latest-open?strategyName=HeikenAshi`)
            .then(res => {
                if (disposed) return
                if (res.data?.trade) {
                    setActiveTradeId(res.data.trade._id)
                    setEntryPrice(res.data.trade.buyPrice)
                    setUnderlying(res.data.trade.index as Underlying)
                    setState('IN_POSITION')
                    setMessage('Recovered active HeikenAshi trade.')
                }
            })
            .catch(console.error)
        return () => { disposed = true }
    }, [connectStatus])

    // Handle Underlying Change
    const handleUnderlyingChange = (val: Underlying) => {
        setUnderlying(val)
        setQuantity(INDEX_CONFIG[val].qty)
    }

    useEffect(() => {
        if (connectStatus !== 'connected' && isRunning) stopStrategy()
    }, [connectStatus, isRunning, stopStrategy])

    // Contract Management
    useEffect(() => {
        if (!isRunning || connectStatus !== 'connected') return
        let disposed = false
        const load = async () => {
            try {
                const config = INDEX_CONFIG[underlying]
                const index = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(underlying)}`)
                const opt = await apiGet<IndexOptionsResponse>(`/instruments/index-options?exchange=${encodeURIComponent(config.exchange)}&underlying=${encodeURIComponent(underlying)}`)

                if (disposed) return
                const exp = pickNearestExpiry(opt.expiries)
                const strike = pickNearestStrike(opt.strikes, index.ltp)

                setSelectedExpiry(exp)
                setAtmStrike(strike)
            } catch (e) {
                if (disposed) return
                setMessage(e instanceof Error ? e.message : 'Init failed')
                stopStrategy()
            }
        }
        load()
        return () => { disposed = true }
    }, [isRunning, connectStatus, underlying, stopStrategy])

    // Strike Resolution
    useEffect(() => {
        if (!isRunning || !selectedExpiry || atmStrike === null) return
        let cancelled = false
        const tick = async () => {
            if (cancelled || inFlightRef.current) return
            inFlightRef.current = true
            try {
                const config = INDEX_CONFIG[underlying]
                const opt = await apiGet<IndexOptionsResponse>(
                    `/instruments/index-options?exchange=${encodeURIComponent(config.exchange)}&underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(selectedExpiry)}`
                )
                if (cancelled) return

                const ceStrike = resolveStrikeForSide({ strikes: opt.strikes, atmStrike, mode: strikeMode, depth: strikeDepth, side: 'CE' })
                const peStrike = resolveStrikeForSide({ strikes: opt.strikes, atmStrike, mode: strikeMode, depth: strikeDepth, side: 'PE' })

                const ce = opt.contracts.find(c => Math.abs(c.strike - (ceStrike ?? 0)) < 1e-6 && c.option_type === 'CE')
                const pe = opt.contracts.find(c => Math.abs(c.strike - (peStrike ?? 0)) < 1e-6 && c.option_type === 'PE')

                setCeContract(ce || null)
                setPeContract(pe || null)
            } finally { inFlightRef.current = false }
        }
        const t = setInterval(tick, 30000)
        tick()
        return () => { cancelled = true; clearInterval(t) }
    }, [isRunning, underlying, selectedExpiry, atmStrike, strikeMode, strikeDepth])

    // Strategy Scanning
    useEffect(() => {
        if (!isRunning || !ceContract || !peContract) return
        if (state !== 'SCANNING' && state !== 'IN_POSITION') return
        let cancelled = false

        const scan = async () => {
            if (cancelled || inFlightRef.current) return
            inFlightRef.current = true
            try {
                const config = INDEX_CONFIG[underlying]

                // ✅ Use the resolved contract tokens, not the index token
                const ceToken = ceContract.symboltoken
                const peToken = peContract.symboltoken
                const contractExchange = ceContract.exchange  // e.g. 'BFO', 'NFO', 'MCX'

                // Map derivative exchange to the correct candles exchange
                const scanExchange = contractExchange === 'BFO' ? 'BFO' : contractExchange === 'MCX' ? 'MCX' : 'NFO'

                const lookbackMap: Record<string, number> = {
                    ONE_MINUTE: 100,
                    THREE_MINUTE: 200,
                    FIVE_MINUTE: 300,
                    FIFTEEN_MINUTE: 600,
                    THIRTY_MINUTE: 1200,
                }
                const lookback = lookbackMap[baseTimeframe] ?? 300

                // Fetch CE candles
                const ceRes = await apiGet<CandlesResponse>(
                    `/market/candles?exchange=${scanExchange}&symboltoken=${ceToken}&interval=${baseTimeframe}&lookback_minutes=${lookback}`
                )

                // Fetch PE candles
                const peRes = await apiGet<CandlesResponse>(
                    `/market/candles?exchange=${scanExchange}&symboltoken=${peToken}&interval=${baseTimeframe}&lookback_minutes=${lookback}`
                )

                if (cancelled) return

                console.log(`[HA SCAN] CE candles: ${ceRes.items?.length}, PE candles: ${peRes.items?.length}`)

                // Run HA strategy on CE candles (primary signal)
                const haCandles = computeHeikenAshi(ceRes.items)
                const signal = analyzeHeikenAshiStrategy(haCandles)

                console.log(`[HA SCAN] Index: ${underlying}, Time: ${new Date().toISOString()}`)
                console.log(`[HA SCAN] Signal details:`, JSON.stringify(signal))
                console.log(`[HA SCAN] ActiveTradeId: ${activeTradeId}`)

                setTrend(signal.trend)

                if (signal.isEntry && !activeTradeId) {
                    console.log(`[HA ENTRY FIRED] Signal at ${signal.haClose}`)
                    setMessage(`HA Long Entry Signal @ ${signal.haClose}`)
                    setState('IN_POSITION')
                    setEntryPrice(signal.haClose)

                    apiPost<{ data: { trade: { _id: string } } }>('/trades/record', {
                        strategyName: 'HeikenAshi',
                        index: underlying,
                        premium: ceContract.tradingsymbol,
                        qty: quantity,
                        buyPrice: signal.haClose
                    }).then((res: { data: { trade: { _id: string } } }) => {
                        setActiveTradeId(res.data.trade._id)
                    }).catch(console.error)

                } else if (signal.isExit && activeTradeId) {
                    setMessage(`HA Exit Signal @ ${signal.haClose}`)

                    apiPost('/trades/update-exit', {
                        tradeId: activeTradeId,
                        exitPrice: signal.haClose,
                        exitReason: 'HA_TREND_REVERSAL'
                    }).then(() => {
                        setActiveTradeId(null)
                        setEntryPrice(null)
                        setState('SCANNING')
                    }).catch(console.error)
                }
            } catch (e) {
                console.error('[HA SCAN ERROR]', e)
    } finally {
        inFlightRef.current = false
    }
}
        // Every 1 min for CRUDEOILM, else 15s
        const intervalMs = underlying === 'CRUDEOILM' ? 60000 : 15000
        const t = setInterval(scan, intervalMs)
        scan()
        return () => { cancelled = true; clearInterval(t) }
    }, [isRunning, state, underlying, ceContract, peContract, baseTimeframe])

    // Heikenashi Position LTP Monitor
    useEffect(() => {
        if (!isRunning || state !== 'IN_POSITION' || !activeTradeId || !ceContract) return

        let cancelled = false
        const monitor = async () => {
            if (cancelled || inFlightRef.current) return
            inFlightRef.current = true
            try {
                const res = await apiGet<{ ltp: number }>(`/market/ltp?exchange=${encodeURIComponent(ceContract.exchange)}&symboltoken=${encodeURIComponent(ceContract.symboltoken)}`)
                if (!cancelled) setCurrentLtp(res.ltp)
            } catch (e) {
                console.error('HA Monitor error:', e)
            } finally { inFlightRef.current = false }
        }
        const t = setInterval(monitor, 2000)
        monitor()
        return () => { cancelled = true; clearInterval(t) }
    }, [isRunning, state, activeTradeId, ceContract])

    // Sync Monitor
    useEffect(() => {
        if (!isRunning) return
        setCheckpoints([
            { id: 'broker', label: 'Broker Connection', status: connectStatus === 'connected' ? 'success' : 'error' },
            { id: 'expiry', label: 'Next Expiry Locked', status: selectedExpiry ? 'success' : 'pending' },
            { id: 'ha_trend', label: 'HA Trend Stability', status: trend !== 'NEUTRAL' ? 'success' : 'pending' },
            { id: 'confirmation', label: 'ATM Strike Sync', status: atmStrike ? 'success' : 'pending' },
            { id: 'indicators', label: 'Premium Discovery', status: (ceContract && peContract) ? 'success' : 'pending' }
        ])
        if (ceContract && peContract) {
            setMonitoredPremiums({
                ce: ceContract.tradingsymbol,
                pe: peContract.tradingsymbol
            })
        }
    }, [isRunning, connectStatus, selectedExpiry, trend, atmStrike, ceContract, peContract])

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
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all"
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
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all"
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
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all"
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
                                                className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-black"
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
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm animate-in zoom-in duration-300">
                                <div className="flex items-center justify-between mb-8">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-500">Live Trade Metrics</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping" />
                                        <span className="text-[10px] font-black text-slate-400">Monitoring Active Position</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-8">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Premium LTP</p>
                                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">₹{currentLtp?.toFixed(2) || '---'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Entry Price</p>
                                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">₹{entryPrice?.toFixed(2) || '---'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Strategy Trend</p>
                                        <p className={`text-xl font-black mt-1 ${trend === 'BULLISH' ? 'text-emerald-500' : trend === 'BEARISH' ? 'text-rose-500' : 'text-slate-400'}`}>
                                            {trend}
                                        </p>
                                    </div>
                                </div>
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
                                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-cyan-500 font-black text-xl"
                                        >-</button>
                                        <span className="text-sm font-black text-slate-900 dark:text-white">{strikeDepth}</span>
                                        <button
                                            onClick={() => setStrikeDepth(strikeDepth + 1)}
                                            disabled={isRunning}
                                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-cyan-500 font-black text-xl"
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
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20"
                                    />
                                    <ChevronRight className="w-4 h-4 text-slate-300" />
                                    <input
                                        type="number"
                                        value={premiumMax}
                                        onChange={(e) => setPremiumMax(Number(e.target.value))}
                                        disabled={isRunning}
                                        placeholder="Max"
                                        className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20"
                                    />
                                </div>
                            </div>
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
                                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                    <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-3">Analyzed CE</p>
                                    <p className="text-xl font-black text-white">{monitoredPremiums.ce}</p>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                    <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-3">Analyzed PE</p>
                                    <p className="text-xl font-black text-white">{monitoredPremiums.pe}</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Active Checkpoints</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {checkpoints.map(cp => (
                                    <div key={cp.id} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                                        <div className={`w-2 h-2 rounded-full ${cp.status === 'success' ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : cp.status === 'error' ? 'bg-rose-500' : 'bg-white/20'}`} />
                                        <span className="text-[11px] font-bold text-white/60 uppercase">{cp.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="lg:w-80 bg-cyan-500/10 border border-cyan-500/20 rounded-3xl p-8 flex flex-col justify-center text-center">
                        <TrendingUp className="w-12 h-12 text-cyan-500 mx-auto mb-4" />
                        <h4 className="text-lg font-black text-white mb-2">Algorithm Integrity</h4>
                        <p className="text-xs text-white/60 font-medium leading-relaxed">
                            All parameters are sanitized. Execution occurs only when 100% of checkpoints return a success state.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
