import { useCallback, useEffect, useRef, useState } from 'react'

import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import StrategiesLayout from './StrategiesLayout'
import { ENABLE_LIVE_TRADING } from '../../config/env'
// import { computeHeikenAshi, detectHeikenAshiTrend } from '../../trading/strategies/heikenAshi'

type HeikenAshiTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

type Underlying = 'SENSEX' | 'NIFTY' | 'BANKNIFTY'
type Exchange = 'BFO' | 'NFO'
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
    exchange: string
    tradingsymbol: string
    symboltoken: string
    ltp: number
}

type StrategyState = 'WAITING' | 'SIGNAL' | 'IN_POSITION' | 'EXITED' | 'STOPPED'

const API_BASE = import.meta.env.VITE_ANGEL_ONE_API_BASE ?? 'http://localhost:8000'

async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as T
}

function asIsoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pickNearestExpiry(expiries: string[]): string | null {
    const todayIso = asIsoDate(new Date())
    const sorted = [...expiries].filter(Boolean).sort()
    for (const e of sorted) {
        if (e >= todayIso) return e
    }
    return sorted.length > 0 ? sorted[sorted.length - 1] : null
}

function pickNearestStrike(strikes: number[], spot: number): number | null {
    if (!Array.isArray(strikes) || strikes.length === 0) return null
    let best: number | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const s of strikes) {
        if (!Number.isFinite(s)) continue
        const d = Math.abs(s - spot)
        if (d < bestDist) {
            bestDist = d
            best = s
        }
    }
    return best
}

function resolveStrikeForSide(params: {
    strikes: number[]
    atmStrike: number
    mode: StrikeMode
    depth: number
    side: 'CE' | 'PE'
}): number | null {
    const { strikes, atmStrike, mode, depth, side } = params
    const sorted = [...strikes].filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
    const idx = sorted.findIndex((s) => Math.abs(s - atmStrike) < 1e-6)
    if (idx < 0) return null

    if (mode === 'ATM') return sorted[idx]

    const steps = Math.max(0, Math.floor(depth))
    if (side === 'CE') {
        // CE: ITM is lower strikes, OTM is higher strikes
        const next = mode === 'ITM' ? idx - steps : idx + steps
        return next >= 0 && next < sorted.length ? sorted[next] : null
    }

    // PE: ITM is higher strikes, OTM is lower strikes
    const next = mode === 'ITM' ? idx + steps : idx - steps
    return next >= 0 && next < sorted.length ? sorted[next] : null
}

const INDEX_CONFIG = {
    SENSEX: { qty: 20, step: 20 },
    NIFTY: { qty: 65, step: 65 },
    BANKNIFTY: { qty: 30, step: 30 },
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

    // Core Configuration
    const [underlying, setUnderlying] = useState<Underlying>('SENSEX')
    const [quantity, setQuantity] = useState<number>(INDEX_CONFIG.SENSEX.qty)
    const [baseTimeframe, setBaseTimeframe] = useState<string>('FIVE_MINUTE')
    const [needConfirmation, setNeedConfirmation] = useState(false)
    const [confirmationTimeframe, setConfirmationTimeframe] = useState<string>('FIVE_MINUTE')

    // Strike Selection
    const [strikeMode, setStrikeMode] = useState<StrikeMode>('ATM')
    const [strikeDepth, setStrikeDepth] = useState<number>(1)
    const [premiumMin, setPremiumMin] = useState<number>(300)
    const [premiumMax, setPremiumMax] = useState<number>(400)
    const [liveTradingConsent, setLiveTradingConsent] = useState(false)

    // Market Data State
    const [atmStrike, setAtmStrike] = useState<number | null>(null)
    const [ceContract, setCeContract] = useState<IndexOptionContract | null>(null)
    const [peContract, setPeContract] = useState<IndexOptionContract | null>(null)
    const [trend, setTrend] = useState<HeikenAshiTrend>('NEUTRAL')
    const [lastHaClose, setLastHaClose] = useState<number | null>(null)
    const [currentLtp, setCurrentLtp] = useState<number | null>(null)
    const [activeSignal, setActiveSignal] = useState<'CE' | 'PE' | null>(null)

    const inFlightRef = useRef(false)
    const stopRequestedRef = useRef(false)

    // Handle Index Change - Update Qty
    const handleUnderlyingChange = (val: Underlying) => {
        setUnderlying(val)
        setQuantity(INDEX_CONFIG[val].qty)
    }

    const adjustQuantity = (delta: number) => {
        const step = INDEX_CONFIG[underlying].step
        setQuantity(prev => Math.max(step, prev + (delta * step)))
    }

    const resetForNextRun = useCallback((nextState: StrategyState) => {
        inFlightRef.current = false
        setMessage('')
        setState(nextState)
        setTrend('NEUTRAL')
        setLastHaClose(null)
        setCurrentLtp(null)
        setActiveSignal(null)
    }, [])

    const stopStrategy = useCallback(() => {
        stopRequestedRef.current = true
        setIsRunning(false)
        setState('STOPPED')
        setMessage('Strategy stopped.')
    }, [])

    const startStrategy = useCallback(() => {
        stopRequestedRef.current = false
        setIsRunning(true)
        resetForNextRun('WAITING')
    }, [resetForNextRun])

    // Contract Resolution logic
    useEffect(() => {
        if (!isRunning || connectStatus !== 'connected') return

        let disposed = false
        async function init() {
            setMessage(`Resolving ${underlying} contracts...`)
            try {
                const indexResponse = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(underlying)}`)
                const exch = (underlying === 'SENSEX' ? 'BFO' : 'NFO') as Exchange
                const opt = await apiGet<IndexOptionsResponse>(
                    `/instruments/index-options?exchange=${encodeURIComponent(exch)}&underlying=${encodeURIComponent(underlying)}`,
                )

                const exp = pickNearestExpiry(opt.expiries)
                if (!exp) throw new Error('No expiries found')

                const atm = pickNearestStrike(opt.strikes, indexResponse.ltp)
                if (atm === null) throw new Error('Unable to pick ATM strike')

                if (disposed) return
                setAtmStrike(atm)

                const ceStrike = resolveStrikeForSide({ strikes: opt.strikes, atmStrike: atm, mode: strikeMode, depth: strikeDepth, side: 'CE' })
                const peStrike = resolveStrikeForSide({ strikes: opt.strikes, atmStrike: atm, mode: strikeMode, depth: strikeDepth, side: 'PE' })

                const ce = opt.contracts.find((c) => c.expiry === exp && Math.abs(c.strike - (ceStrike ?? 0)) < 1e-6 && c.option_type === 'CE') ?? null
                const pe = opt.contracts.find((c) => c.expiry === exp && Math.abs(c.strike - (peStrike ?? 0)) < 1e-6 && c.option_type === 'PE') ?? null

                setCeContract(ce)
                setPeContract(pe)
                setMessage('Contracts ready. Scanning for signal...')
            } catch (e) {
                if (disposed) return
                setMessage(e instanceof Error ? e.message : 'Resolution failed')
                setIsRunning(false)
                setState('STOPPED')
            }
        }
        void init()
        return () => { disposed = true }
    }, [connectStatus, isRunning, strikeDepth, strikeMode, underlying])

    // Scanning loop (Placeholder for logic)
    useEffect(() => {
        if (!isRunning || connectStatus !== 'connected' || state !== 'WAITING') return
        if (!ceContract || !peContract) return

        let cancelled = false
        const intervalMs = 10000

        async function tick() {
            if (cancelled || stopRequestedRef.current || inFlightRef.current) return
            inFlightRef.current = true
            try {
                // Signal logic goes here
                setMessage('Scanning... Strategy logic formulation in progress.')
                // Using declared variables to satisfy lint
                if (activeSignal && lastHaClose) {
                    console.log('Context:', activeSignal, lastHaClose)
                }
            } catch (e) {
                setMessage(e instanceof Error ? e.message : 'Scan failed')
            } finally {
                inFlightRef.current = false
            }
        }

        const t = window.setInterval(tick, intervalMs)
        void tick()
        return () => { cancelled = true; window.clearInterval(t) }
    }, [activeSignal, ceContract, connectStatus, isRunning, lastHaClose, peContract, state])

    return (
        <StrategiesLayout
            title="Heikenashi Strategy"
            subtitle="Trend following strategy using Heiken Ashi candles"
            backTo="/strategies"
        >
            <div className="space-y-6">
                {/* Status Header */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h2 className="text-base font-semibold">Strategy Control Center</h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{message || 'Ready to start.'}</p>
                            <div className="mt-4 flex gap-12">
                                <div>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Status</p>
                                    <p className={`text-sm font-semibold transition-colors ${isRunning ? 'text-emerald-500' : 'text-slate-400'}`}>
                                        {isRunning ? 'RUNNING' : 'IDLE'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Strategy State</p>
                                    <p className="text-sm font-semibold">{state}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Heikenashi Trend</p>
                                    <p className={`text-sm font-semibold ${trend === 'BULLISH' ? 'text-emerald-500' : trend === 'BEARISH' ? 'text-rose-500' : ''}`}>
                                        {trend}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            {!isRunning ? (
                                <button
                                    onClick={startStrategy}
                                    disabled={connectStatus !== 'connected'}
                                    className="rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-8 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:scale-105 disabled:opacity-50"
                                >
                                    START STRATEGY
                                </button>
                            ) : (
                                <button
                                    onClick={stopStrategy}
                                    className="rounded-xl bg-rose-500 px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-rose-500/20 transition hover:scale-105"
                                >
                                    STOP STRATEGY
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    {/* Main Configuration - Left */}
                    <div className="space-y-6 lg:col-span-8">
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
                            <h3 className="mb-6 text-sm font-bold uppercase tracking-widest text-slate-500">Execution Parameters</h3>

                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {/* Index & Quantity Section */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-semibold text-slate-500">Underlying Index</label>
                                        <select
                                            value={underlying}
                                            onChange={(e) => handleUnderlyingChange(e.target.value as Underlying)}
                                            disabled={isRunning}
                                            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm font-medium focus:ring-2 focus:ring-cyan-500 outline-none dark:border-white/5 dark:bg-slate-800"
                                        >
                                            <option value="SENSEX">SENSEX</option>
                                            <option value="NIFTY">NIFTY</option>
                                            <option value="BANKNIFTY">BANKNIFTY</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs font-semibold text-slate-500">Trade Quantity</label>
                                        <div className="mt-1.5 flex items-center gap-2">
                                            <button
                                                onClick={() => adjustQuantity(-1)}
                                                disabled={isRunning}
                                                className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold hover:bg-slate-200 disabled:opacity-30 dark:bg-slate-800 dark:hover:bg-slate-700"
                                            >-</button>
                                            <input
                                                type="number"
                                                readOnly
                                                value={quantity}
                                                className="h-10 grow rounded-xl border border-slate-200 bg-slate-50 text-center text-sm font-bold dark:border-white/5 dark:bg-slate-800"
                                            />
                                            <button
                                                onClick={() => adjustQuantity(1)}
                                                disabled={isRunning}
                                                className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold hover:bg-slate-200 disabled:opacity-30 dark:bg-slate-800 dark:hover:bg-slate-700"
                                            >+</button>
                                        </div>
                                        <p className="mt-1.5 text-[10px] text-slate-400 italic">Increments by {INDEX_CONFIG[underlying].step} units (Index Lot)</p>
                                    </div>
                                </div>

                                {/* Timeframe Section */}
                                <div className="space-y-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
                                    <div>
                                        <label className="text-xs font-semibold text-slate-500">Base Timeframe</label>
                                        <select
                                            value={baseTimeframe}
                                            onChange={(e) => setBaseTimeframe(e.target.value)}
                                            disabled={isRunning}
                                            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-medium outline-none dark:border-white/5 dark:bg-slate-800"
                                        >
                                            {TIMEFRAME_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex items-center gap-3 py-1">
                                        <input
                                            type="checkbox"
                                            id="confCheck"
                                            checked={needConfirmation}
                                            onChange={(e) => setNeedConfirmation(e.target.checked)}
                                            disabled={isRunning}
                                            className="h-4 w-4 rounded accent-cyan-400"
                                        />
                                        <label htmlFor="confCheck" className="text-xs font-bold text-slate-600 dark:text-slate-400 cursor-pointer">NEED CONFIRMATION</label>
                                    </div>

                                    {needConfirmation && (
                                        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                            <label className="text-xs font-semibold text-slate-500">Confirmation Timeframe</label>
                                            <select
                                                value={confirmationTimeframe}
                                                onChange={(e) => setConfirmationTimeframe(e.target.value)}
                                                disabled={isRunning}
                                                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-medium outline-none dark:border-white/5 dark:bg-slate-800"
                                            >
                                                {TIMEFRAME_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="mt-8 flex items-center gap-3 border-t border-slate-100 pt-6 dark:border-white/5">
                                <input
                                    type="checkbox"
                                    id="liveTrCons"
                                    checked={liveTradingConsent}
                                    onChange={(e) => setLiveTradingConsent(e.target.checked)}
                                    disabled={isRunning || !ENABLE_LIVE_TRADING}
                                    className="h-5 w-5 rounded accent-rose-500"
                                />
                                <label htmlFor="liveTrCons" className="text-sm font-bold text-rose-500 cursor-pointer">ENABLE LIVE TRADING EXECUTION</label>
                            </div>
                        </div>
                    </div>

                    {/* Advanced Selection - Right */}
                    <div className="space-y-6 lg:col-span-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
                            <h3 className="mb-6 text-sm font-bold uppercase tracking-widest text-slate-500">Advanced Selection</h3>

                            <div className="space-y-5">
                                <div>
                                    <label className="text-xs font-semibold text-slate-500">Strike Mode</label>
                                    <select
                                        value={strikeMode}
                                        onChange={(e) => setStrikeMode(e.target.value as StrikeMode)}
                                        disabled={isRunning}
                                        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm font-medium outline-none dark:border-white/5 dark:bg-slate-800"
                                    >
                                        <option value="ATM">ATM (At the Money)</option>
                                        <option value="ITM">ITM (In the Money)</option>
                                        <option value="OTM">OTM (Out the Money)</option>
                                    </select>
                                </div>

                                {strikeMode !== 'ATM' && (
                                    <div className="animate-in zoom-in duration-200">
                                        <label className="text-xs font-semibold text-slate-500">Strike Depth</label>
                                        <div className="mt-1.5 flex items-center gap-2">
                                            <button
                                                onClick={() => setStrikeDepth(d => Math.max(1, d - 1))}
                                                disabled={isRunning}
                                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                                            >-</button>
                                            <input
                                                type="number"
                                                value={strikeDepth}
                                                readOnly
                                                className="h-9 grow rounded-lg border border-slate-200 bg-slate-50 text-center text-sm font-bold dark:border-white/5 dark:bg-slate-800"
                                            />
                                            <button
                                                onClick={() => setStrikeDepth(d => d + 1)}
                                                disabled={isRunning}
                                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                                            >+</button>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 dark:border-white/5">
                                    <div>
                                        <label className="text-xs font-semibold text-slate-500">Premium Min</label>
                                        <input
                                            type="number"
                                            value={premiumMin}
                                            onChange={(e) => setPremiumMin(Number(e.target.value))}
                                            disabled={isRunning}
                                            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm font-bold outline-none dark:border-white/5 dark:bg-slate-800"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-slate-500">Premium Max</label>
                                        <input
                                            type="number"
                                            value={premiumMax}
                                            onChange={(e) => setPremiumMax(Number(e.target.value))}
                                            disabled={isRunning}
                                            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm font-bold outline-none dark:border-white/5 dark:bg-slate-800"
                                        />
                                    </div>
                                </div>

                                {isRunning && (
                                    <div className="mt-6 rounded-xl bg-cyan-50 p-4 border border-cyan-100 dark:bg-cyan-500/5 dark:border-cyan-500/10">
                                        <p className="text-[10px] text-cyan-600 font-bold uppercase tracking-widest mb-2">Live Monitor</p>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs font-medium">
                                                <span className="text-slate-500">ATM Strike</span>
                                                <span className="text-slate-900 dark:text-slate-100">{atmStrike || '---'}</span>
                                            </div>
                                            <div className="flex justify-between text-xs font-medium">
                                                <span className="text-slate-500">Active CE</span>
                                                <span className={`text-slate-900 dark:text-slate-100 ${activeSignal === 'CE' ? 'underline decoration-cyan-400' : ''}`}>
                                                    {ceContract?.tradingsymbol || '---'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between text-xs font-medium">
                                                <span className="text-slate-500">Active PE</span>
                                                <span className={`text-slate-900 dark:text-slate-100 ${activeSignal === 'PE' ? 'underline decoration-cyan-400' : ''}`}>
                                                    {peContract?.tradingsymbol || '---'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between text-xs font-medium">
                                                <span className="text-slate-500">HA Close</span>
                                                <span className="text-slate-900 dark:text-slate-100">{lastHaClose?.toFixed(2) || '---'}</span>
                                            </div>
                                            <div className="flex justify-between text-xs font-medium pt-1 border-t border-cyan-100 dark:border-white/5">
                                                <span className="text-slate-500">LTP</span>
                                                <span className="text-cyan-600 font-bold">{currentLtp || '---'}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </StrategiesLayout>
    )
}
