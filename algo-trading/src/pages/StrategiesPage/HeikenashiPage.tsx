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
type ExitStrategy = 'CANDLES' | 'TARGET'

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

    // Exit Strategy Configuration
    const [exitStrategy, setExitStrategy] = useState<ExitStrategy>('CANDLES')
    const [targetPoints, setTargetPoints] = useState<number>(20)

    const [liveTradingConsent, setLiveTradingConsent] = useState(false)

    // Strategy Execution State
    const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
    const [atmStrike, setAtmStrike] = useState<number | null>(null)
    const [ceContract, setCeContract] = useState<IndexOptionContract | null>(null)
    const [peContract, setPeContract] = useState<IndexOptionContract | null>(null)

    const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
    const [activeTradePremium, setActiveTradePremium] = useState<string | null>(null)
    const [entryPrice, setEntryPrice] = useState<number | null>(null)
    const [currentLtp, setCurrentLtp] = useState<number | null>(null)

    // ─── Refs ────────────────────────────────────────────────────────────────
    const inFlightRef = useRef(false)

    /**
     * activeTradeRef mirrors activeTradeId + activeTradePremium in a ref so
     * the scan interval closure always reads the *current* value without needing
     * to be listed in the dependency array (which would restart the interval on
     * every entry/exit and cause duplicate orders).
     */
    const activeTradeRef = useRef<{ tradeId: string | null; premium: string | null }>({
        tradeId: null,
        premium: null,
    })

    /** Single helper that keeps state + ref in sync atomically. */
    const setActiveTrade = useCallback((tradeId: string | null, premium: string | null) => {
        activeTradeRef.current = { tradeId, premium }
        setActiveTradeId(tradeId)
        setActiveTradePremium(premium)
    }, [])

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const asIsoDate = (d: Date) => d.toISOString().split('T')[0]

    const pickNearestExpiry = (expiries: string[]) => {
        const today = asIsoDate(new Date())
        const valid = expiries.filter(Boolean).sort()
        return valid.find(e => e >= today) || (valid.length ? valid[valid.length - 1] : null)
    }

    const pickNearestStrike = (strikes: number[], spot: number) => {
        if (!strikes.length) return null
        return strikes.reduce((prev, curr) =>
            Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
        )
    }

    const resolveStrikeForSide = (params: {
        strikes: number[]
        atmStrike: number
        mode: StrikeMode
        depth: number
        side: 'CE' | 'PE'
    }) => {
        const { strikes, atmStrike, mode, depth, side } = params
        const sorted = [...strikes].filter(Number.isFinite).sort((a, b) => a - b)
        const idx = sorted.findIndex(s => Math.abs(s - atmStrike) < 1e-6)
        if (idx < 0) return null
        if (mode === 'ATM') return sorted[idx]
        const steps = Math.max(0, Math.floor(depth))
        const offset = (side === 'CE' ? 1 : -1) * (mode === 'ITM' ? -1 : 1) * steps
        const next = idx + offset
        return next >= 0 && next < sorted.length ? sorted[next] : null
    }

    // ─── Strategy controls ───────────────────────────────────────────────────
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
        setActiveTrade(null, null)
        setEntryPrice(null)
        setCurrentLtp(null)
    }, [setActiveTrade])

    // ─── Recover open trade on mount ─────────────────────────────────────────
    useEffect(() => {
        if (connectStatus !== 'connected') return
        let disposed = false
        apiGet<{
            data: {
                trade?: {
                    _id: string
                    buyPrice: number
                    index: Underlying
                    strategyName: string
                    premium?: string
                }
            }
        }>(`/trades/latest-open?strategyName=HeikenAshi`)
            .then(res => {
                if (disposed) return
                if (res.data?.trade) {
                    const t = res.data.trade
                    setActiveTrade(t._id, t.premium || null)
                    setEntryPrice(t.buyPrice)
                    setUnderlying(t.index as Underlying)
                    setState('IN_POSITION')
                    setMessage('Recovered active HeikenAshi trade.')
                }
            })
            .catch(console.error)
        return () => { disposed = true }
    }, [connectStatus, setActiveTrade])

    // ─── Stop if broker disconnects ──────────────────────────────────────────
    const handleUnderlyingChange = (val: Underlying) => {
        setUnderlying(val)
        setQuantity(INDEX_CONFIG[val].qty)
    }

    useEffect(() => {
        if (connectStatus !== 'connected' && isRunning) stopStrategy()
    }, [connectStatus, isRunning, stopStrategy])

    // ─── Contract Management: resolve expiry + ATM strike ────────────────────
    useEffect(() => {
        if (!isRunning || connectStatus !== 'connected') return
        let disposed = false
        const load = async () => {
            try {
                const config = INDEX_CONFIG[underlying]
                const index = await apiGet<MarketIndexLtpResponse>(
                    `/market/index-ltp?underlying=${encodeURIComponent(underlying)}`
                )
                const opt = await apiGet<IndexOptionsResponse>(
                    `/instruments/index-options?exchange=${encodeURIComponent(config.exchange)}&underlying=${encodeURIComponent(underlying)}`
                )
                if (disposed) return
                setSelectedExpiry(pickNearestExpiry(opt.expiries))
                setAtmStrike(pickNearestStrike(opt.strikes, index.ltp))
            } catch (e) {
                if (disposed) return
                setMessage(e instanceof Error ? e.message : 'Init failed')
                stopStrategy()
            }
        }
        load()
        return () => { disposed = true }
    }, [isRunning, connectStatus, underlying, stopStrategy])

    // ─── Strike Resolution: pick CE/PE contracts ──────────────────────────────
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
            } finally {
                inFlightRef.current = false
            }
        }
        const t = setInterval(tick, 30_000)
        tick()
        return () => { cancelled = true; clearInterval(t) }
    }, [isRunning, underlying, selectedExpiry, atmStrike, strikeMode, strikeDepth])

    // ─── Strategy Scanning ────────────────────────────────────────────────────
    useEffect(() => {
        if (!isRunning || !ceContract || !peContract) return
        if (state !== 'SCANNING' && state !== 'IN_POSITION') return
        let cancelled = false

        // Snapshot contract references so the closure always has the correct tokens
        // even if the parent component re-renders and swaps contracts mid-interval.
        const snapCe = ceContract
        const snapPe = peContract

        const scan = async () => {
            if (cancelled || inFlightRef.current) return
            inFlightRef.current = true
            try {
                // ✅ Always read fresh trade state from the ref — never from stale closure state
                const { tradeId: currentTradeId, premium: currentPremium } = activeTradeRef.current

                const scanExchange =
                    snapCe.exchange === 'BFO' ? 'BFO' :
                        snapCe.exchange === 'MCX' ? 'MCX' : 'NFO'

                const lookbackMap: Record<string, number> = {
                    ONE_MINUTE: 100,
                    THREE_MINUTE: 200,
                    FIVE_MINUTE: 300,
                    FIFTEEN_MINUTE: 600,
                    THIRTY_MINUTE: 1200,
                }
                const lookback = lookbackMap[baseTimeframe] ?? 300

                // ✅ Use the resolved option contract tokens (not the index token)
                const [ceRes, peRes] = await Promise.all([
                    apiGet<CandlesResponse>(
                        `/market/candles?exchange=${scanExchange}&symboltoken=${snapCe.symboltoken}&interval=${baseTimeframe}&lookback_minutes=${lookback}`
                    ),
                    apiGet<CandlesResponse>(
                        `/market/candles?exchange=${scanExchange}&symboltoken=${snapPe.symboltoken}&interval=${baseTimeframe}&lookback_minutes=${lookback}`
                    ),
                ])

                if (cancelled) return

                console.log(`[HA SCAN] Index: ${underlying}, Time: ${new Date().toISOString()}`)
                console.log(`[HA SCAN] CE token: ${snapCe.symboltoken} | candles: ${ceRes.items?.length}`)
                console.log(`[HA SCAN] PE token: ${snapPe.symboltoken} | candles: ${peRes.items?.length}`)

                const ceHa = computeHeikenAshi(ceRes.items)
                const peHa = computeHeikenAshi(peRes.items)

                const ceSignal = analyzeHeikenAshiStrategy(ceHa)
                const peSignal = analyzeHeikenAshiStrategy(peHa)

                console.log(`[HA SCAN] CE Signal:`, JSON.stringify(ceSignal))
                console.log(`[HA SCAN] PE Signal:`, JSON.stringify(peSignal))
                console.log(`[HA SCAN] ActiveTradeId (ref): ${currentTradeId}, Premium (ref): ${currentPremium}`)

                if (!currentTradeId) {
                    // ── ENTRY LOGIC ──────────────────────────────────────────
                    if (ceSignal.isEntry) {
                        console.log(`[HA ENTRY] CE @ ${ceSignal.haClose}`)
                        setMessage(`HA Long Entry CE @ ${ceSignal.haClose}`)
                        setState('IN_POSITION')
                        setEntryPrice(ceSignal.haClose)
                        setTrend('BULLISH')

                        // Mark premium immediately in the ref so the next interval
                        // tick sees it even before the API call completes.
                        setActiveTrade(null, snapCe.tradingsymbol)

                        const res = await apiPost<{ data: { trade: { _id: string } } }>('/trades/record', {
                            strategyName: 'HeikenAshi',
                            index: underlying,
                            premium: snapCe.tradingsymbol,
                            qty: quantity,
                            buyPrice: ceSignal.haClose,
                        })
                        setActiveTrade(res.data.trade._id, snapCe.tradingsymbol)

                    } else if (peSignal.isEntry) {
                        console.log(`[HA ENTRY] PE @ ${peSignal.haClose}`)
                        setMessage(`HA Long Entry PE @ ${peSignal.haClose}`)
                        setState('IN_POSITION')
                        setEntryPrice(peSignal.haClose)
                        setTrend('BEARISH')

                        // Mark premium immediately in the ref
                        setActiveTrade(null, snapPe.tradingsymbol)

                        const res = await apiPost<{ data: { trade: { _id: string } } }>('/trades/record', {
                            strategyName: 'HeikenAshi',
                            index: underlying,
                            premium: snapPe.tradingsymbol,
                            qty: quantity,
                            buyPrice: peSignal.haClose,
                        })
                        setActiveTrade(res.data.trade._id, snapPe.tradingsymbol)

                    } else {
                        setTrend(ceSignal.trend)
                    }

                } else {
                    // ── EXIT LOGIC ───────────────────────────────────────────
                    const isCeTrade = currentPremium === snapCe.tradingsymbol
                    const isPeTrade = currentPremium === snapPe.tradingsymbol

                    let shouldExit = false
                    let exitPrice = currentLtp || (isCeTrade ? ceSignal.haClose : peSignal.haClose)
                    let exitReason = ''

                    if (exitStrategy === 'CANDLES') {
                        shouldExit = (isCeTrade && ceSignal.isExit) || (isPeTrade && peSignal.isExit)
                        if (shouldExit) {
                            exitPrice = isCeTrade ? ceSignal.haClose : peSignal.haClose
                            exitReason = 'HA_TREND_REVERSAL'
                        }
                    } else if (exitStrategy === 'TARGET') {
                        // We need the current LTP of the specific option to check targets.
                        // We can fetch it directly here if currentLtp is stale, or rely on the monitor.
                        // For safety inside the loop, let's do a quick fetch of the active instrument's LTP 
                        // to guarantee we have the absolute latest price for SL/Target checking.
                        const activeToken = isCeTrade ? snapCe.symboltoken : snapPe.symboltoken
                        const activeExchange = isCeTrade ? snapCe.exchange : snapPe.exchange

                        try {
                            const ltpRes = await apiGet<{ ltp: number }>(`/market/ltp?exchange=${encodeURIComponent(activeExchange)}&tradingsymbol=${encodeURIComponent(currentPremium || '')}&symboltoken=${encodeURIComponent(activeToken)}`)
                            const livePrice = ltpRes.ltp

                            if (entryPrice) {
                                const targetPrice = entryPrice + targetPoints
                                const slPrice = entryPrice - (targetPoints * 2)

                                if (livePrice >= targetPrice) {
                                    shouldExit = true
                                    exitPrice = livePrice
                                    exitReason = 'Target'
                                } else if (livePrice <= slPrice) {
                                    shouldExit = true
                                    exitPrice = livePrice
                                    exitReason = 'SL'
                                }
                            }
                        } catch (err) {
                            console.error('LTP fetch failed during target check', err)
                        }
                    }

                    if (shouldExit) {
                        console.log(`[HA EXIT] @ ${exitPrice} Reason: ${exitReason}`)
                        setMessage(`HA Exit Signal @ ${exitPrice} (${exitReason})`)

                        await apiPost('/trades/update-exit', {
                            tradeId: currentTradeId,
                            exitPrice,
                            exitReason,
                        })

                        setActiveTrade(null, null)
                        setEntryPrice(null)
                        setState('SCANNING')
                        setTrend('NEUTRAL')
                    }
                }
            } catch (e) {
                console.error('[HA SCAN ERROR]', e)
            } finally {
                inFlightRef.current = false
            }
        }

        const intervalMs = underlying === 'CRUDEOILM' ? 60_000 : 15_000
        const t = setInterval(scan, intervalMs)
        scan()
        return () => { cancelled = true; clearInterval(t) }

        // ✅ activeTradeId / activeTradePremium intentionally excluded —
        //    we read live values from activeTradeRef inside the closure instead.
    }, [isRunning, state, underlying, ceContract, peContract, baseTimeframe, quantity, setActiveTrade, exitStrategy, targetPoints, currentLtp, entryPrice])

    // ─── LTP Monitor for active position ─────────────────────────────────────
    useEffect(() => {
        if (!isRunning || state !== 'IN_POSITION' || !activeTradeId || !activeTradePremium) return

        const contract =
            ceContract?.tradingsymbol === activeTradePremium ? ceContract :
                peContract?.tradingsymbol === activeTradePremium ? peContract :
                    null

        if (!contract) return

        let cancelled = false
        const monitor = async () => {
            if (cancelled) return
            try {
                const res = await apiGet<{ ltp: number }>(
                    `/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`
                )
                if (!cancelled) setCurrentLtp(res.ltp)
            } catch (e) {
                console.error('HA Monitor error:', e)
            }
        }
        const t = setInterval(monitor, 2_000)
        monitor()
        return () => { cancelled = true; clearInterval(t) }
    }, [isRunning, state, activeTradeId, activeTradePremium, ceContract, peContract])

    // ─── Checkpoint / monitor sync ────────────────────────────────────────────
    useEffect(() => {
        if (!isRunning) return
        setCheckpoints([
            { id: 'broker', label: 'Broker Connection', status: connectStatus === 'connected' ? 'success' : 'error' },
            { id: 'expiry', label: 'Next Expiry Locked', status: selectedExpiry ? 'success' : 'pending' },
            { id: 'ha_trend', label: 'HA Trend Stability', status: trend !== 'NEUTRAL' ? 'success' : 'pending' },
            { id: 'confirmation', label: 'ATM Strike Sync', status: atmStrike ? 'success' : 'pending' },
            { id: 'indicators', label: 'Premium Discovery', status: ceContract && peContract ? 'success' : 'pending' },
        ])
        if (ceContract && peContract) {
            setMonitoredPremiums({ ce: ceContract.tradingsymbol, pe: peContract.tradingsymbol })
        }
    }, [isRunning, connectStatus, selectedExpiry, trend, atmStrike, ceContract, peContract])

    // ─── Render ───────────────────────────────────────────────────────────────
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
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Exit Strategy</label>
                                <div className="space-y-3">
                                    <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setExitStrategy('CANDLES')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${exitStrategy === 'CANDLES' ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-300 dark:border-white/20'}`}>
                                            <div className={`w-2.5 h-2.5 rounded-full bg-cyan-500 transition-all ${exitStrategy === 'CANDLES' ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`} />
                                        </div>
                                        <span className={`text-sm font-bold transition-all ${exitStrategy === 'CANDLES' ? 'text-cyan-500' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                                            2 Consecutive Red Candles
                                        </span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setExitStrategy('TARGET')}>
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
                                <div className="animate-in slide-in-from-top-2 duration-300">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Points to Target</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={targetPoints}
                                            onChange={(e) => setTargetPoints(parseFloat(e.target.value) || 0)}
                                            disabled={isRunning}
                                            placeholder="e.g. 20"
                                            className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20"
                                        />
                                        <div className="text-[10px] font-black text-rose-500 uppercase tracking-widest whitespace-nowrap">
                                            SL: {targetPoints * 2} pts
                                        </div>
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
                                <div className={`border rounded-2xl p-6 backdrop-blur-xl transition-all ${activeTradePremium === ceContract?.tradingsymbol
                                    ? 'bg-cyan-500/20 border-cyan-500/40'
                                    : 'bg-white/5 border-white/10'
                                    }`}>
                                    <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-1">Analyzed CE</p>
                                    {activeTradePremium === ceContract?.tradingsymbol && (
                                        <p className="text-[9px] font-black text-cyan-400 uppercase tracking-widest mb-2">● ACTIVE TRADE</p>
                                    )}
                                    <p className="text-xl font-black text-white">{monitoredPremiums.ce}</p>
                                </div>
                                <div className={`border rounded-2xl p-6 backdrop-blur-xl transition-all ${activeTradePremium === peContract?.tradingsymbol
                                    ? 'bg-rose-500/20 border-rose-500/40'
                                    : 'bg-white/5 border-white/10'
                                    }`}>
                                    <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Analyzed PE</p>
                                    {activeTradePremium === peContract?.tradingsymbol && (
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