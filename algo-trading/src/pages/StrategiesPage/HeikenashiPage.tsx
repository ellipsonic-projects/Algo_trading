import { useCallback, useEffect, useRef, useState } from 'react'

import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import StrategiesLayout from './StrategiesLayout'
import { ENABLE_LIVE_TRADING } from '../../config/env'
import { computeHeikenAshi, detectHeikenAshiTrend, type HeikenAshiTrend } from '../../trading/strategies/heikenAshi'
import type { Candle } from '../../trading/strategies/premiumRangeBreakout'

type Underlying = 'SENSEX' | 'NIFTY' | 'BANKNIFTY'
type Exchange = 'BFO' | 'NFO'

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

type LtpResponse = {
    exchange: string
    tradingsymbol: string
    symboltoken: string
    ltp: number
}

type CandlesResponse = {
    items: Candle[]
}

type PlaceOrderResponse = {
    item: {
        id: string
        created_at: string
        request: Record<string, unknown>
        response: Record<string, unknown>
    }
}

type StrategyState = 'WAITING' | 'SIGNAL' | 'IN_POSITION' | 'EXITED' | 'STOPPED'

const API_BASE = import.meta.env.VITE_ANGEL_ONE_API_BASE ?? 'http://localhost:8000'

async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as T
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
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

export default function HeikenashiPage() {
    const { connectStatus } = useAngelConnection()

    const [isRunning, setIsRunning] = useState(false)
    const [state, setState] = useState<StrategyState>('STOPPED')
    const [message, setMessage] = useState<string>('')

    const [underlying, setUnderlying] = useState<Underlying>('SENSEX')
    const [interval, setInterval] = useState<string>('ONE_MINUTE')
    const [quantity, setQuantity] = useState<number>(10)
    const [liveTradingConsent, setLiveTradingConsent] = useState(false)

    const [atmStrike, setAtmStrike] = useState<number | null>(null)
    const [ceContract, setCeContract] = useState<IndexOptionContract | null>(null)
    const [peContract, setPeContract] = useState<IndexOptionContract | null>(null)

    const [trend, setTrend] = useState<HeikenAshiTrend>('NEUTRAL')
    const [lastHaClose, setLastHaClose] = useState<number | null>(null)
    const [currentLtp, setCurrentLtp] = useState<number | null>(null)
    const [activeSignal, setActiveSignal] = useState<'CE' | 'PE' | null>(null)

    const inFlightRef = useRef(false)
    const stopRequestedRef = useRef(false)

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

    // Load contracts
    useEffect(() => {
        if (!isRunning || connectStatus !== 'connected') return

        let disposed = false
        async function init() {
            setMessage(`Loading ${underlying} contracts...`)
            try {
                const index = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(underlying)}`)
                const exch = underlying === 'SENSEX' ? 'BFO' : 'NFO'
                const opt = await apiGet<IndexOptionsResponse>(
                    `/instruments/index-options?exchange=${encodeURIComponent(exch)}&underlying=${encodeURIComponent(underlying)}`,
                )

                const exp = pickNearestExpiry(opt.expiries)
                if (!exp) throw new Error('No expiries found')

                const strike = pickNearestStrike(opt.strikes, index.ltp)
                if (strike === null) throw new Error('Unable to pick ATM strike')

                if (disposed) return
                setAtmStrike(strike)

                // Resolve ATM contracts
                const ce = opt.contracts.find((c) => c.expiry === exp && Math.abs(c.strike - strike) < 1e-6 && c.option_type === 'CE') ?? null
                const pe = opt.contracts.find((c) => c.expiry === exp && Math.abs(c.strike - strike) < 1e-6 && c.option_type === 'PE') ?? null

                setCeContract(ce)
                setPeContract(pe)
                setMessage('Contracts ready. Waiting for trend signal...')
            } catch (e) {
                if (disposed) return
                setMessage(e instanceof Error ? e.message : 'Init failed')
                setIsRunning(false)
                setState('STOPPED')
            }
        }
        void init()
        return () => { disposed = true }
    }, [connectStatus, isRunning, underlying])

    // Main execution loop
    useEffect(() => {
        if (!isRunning || connectStatus !== 'connected' || state !== 'WAITING') return
        if (!ceContract || !peContract) return

        let cancelled = false
        const intervalMs = 10000

        async function tick() {
            if (cancelled || stopRequestedRef.current || inFlightRef.current) return
            inFlightRef.current = true

            try {
                // We use index candles for trend detection
                const spot = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(underlying)}`)
                const candles = await apiGet<CandlesResponse>(
                    `/market/candles?exchange=${encodeURIComponent(spot.exchange)}&symboltoken=${encodeURIComponent(spot.symboltoken)}&interval=${interval}&lookback_minutes=60`,
                )

                const ha = computeHeikenAshi(candles.items ?? [])
                const currentTrend = detectHeikenAshiTrend(ha)
                setTrend(currentTrend)
                if (ha.length > 0) setLastHaClose(ha[ha.length - 1].close)

                if (currentTrend !== 'NEUTRAL') {
                    const side = currentTrend === 'BULLISH' ? 'CE' : 'PE'
                    const contract = side === 'CE' ? ceContract : peContract
                    setActiveSignal(side)

                    if (contract) {
                        const ltpInfo = await apiGet<LtpResponse>(
                            `/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`,
                        )
                        setCurrentLtp(ltpInfo.ltp)

                        if (ENABLE_LIVE_TRADING && liveTradingConsent) {
                            setMessage(`Trend detected: ${currentTrend}. Placing trade for ${side}...`)
                            await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
                                exchange: contract.exchange,
                                tradingsymbol: contract.tradingsymbol,
                                symboltoken: contract.symboltoken,
                                transactiontype: 'BUY',
                                producttype: 'INTRADAY',
                                quantity: quantity, // Should use normalized quantity ideally
                                ordertype: 'MARKET',
                            })
                            setState('IN_POSITION')
                        } else {
                            setMessage(`Trend detected: ${currentTrend}. Signal only mode.`)
                        }
                    }
                } else {
                    setMessage('Scanning... No clear trend detected yet.')
                }

            } catch (e) {
                setMessage(e instanceof Error ? e.message : 'Tick failed')
            } finally {
                inFlightRef.current = false
            }
        }

        const t = window.setInterval(tick, intervalMs)
        void tick()
        return () => { cancelled = true; window.clearInterval(t) }
    }, [ceContract, connectStatus, interval, isRunning, liveTradingConsent, peContract, quantity, state, underlying])

    return (
        <StrategiesLayout
            title="Heikenashi Strategy"
            subtitle="Trend following strategy using Heiken Ashi candles"
            backTo="/strategies"
        >
            <div className="space-y-6">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h2 className="text-base font-semibold">Strategy Status</h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{message || 'Ready.'}</p>
                            <div className="mt-4 flex gap-8">
                                <div>
                                    <p className="text-xs text-slate-500 uppercase">State</p>
                                    <p className="font-semibold">{state}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 uppercase">Trend</p>
                                    <p className={`font-semibold ${trend === 'BULLISH' ? 'text-emerald-500' : trend === 'BEARISH' ? 'text-rose-500' : ''}`}>{trend}</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            {!isRunning ? (
                                <button
                                    onClick={startStrategy}
                                    disabled={connectStatus !== 'connected'}
                                    className="rounded-xl bg-cyan-400 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
                                >
                                    Start Strategy
                                </button>
                            ) : (
                                <button
                                    onClick={stopStrategy}
                                    className="rounded-xl bg-rose-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
                                >
                                    Stop Strategy
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {/* Settings Card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-900">
                        <h3 className="mb-4 font-semibold">Configuration</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-500">Underlying</label>
                                <select
                                    value={underlying}
                                    onChange={(e) => setUnderlying(e.target.value as Underlying)}
                                    disabled={isRunning}
                                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 dark:border-white/10 dark:bg-slate-800"
                                >
                                    <option value="SENSEX">SENSEX</option>
                                    <option value="NIFTY">NIFTY</option>
                                    <option value="BANKNIFTY">BANKNIFTY</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-500">Interval</label>
                                    <select
                                        value={interval}
                                        onChange={(e) => setInterval(e.target.value)}
                                        disabled={isRunning}
                                        className="mt-1 w-full rounded-lg border border-slate-200 p-2 dark:border-white/10 dark:bg-slate-800"
                                    >
                                        <option value="ONE_MINUTE">1 Minute</option>
                                        <option value="FIVE_MINUTE">5 Minutes</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500">Total Quantity</label>
                                    <input
                                        type="number"
                                        value={quantity}
                                        onChange={(e) => setQuantity(Number(e.target.value))}
                                        disabled={isRunning}
                                        className="mt-1 w-full rounded-lg border border-slate-200 p-2 dark:border-white/10 dark:bg-slate-800"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="checkbox"
                                    id="consent"
                                    checked={liveTradingConsent}
                                    onChange={(e) => setLiveTradingConsent(e.target.checked)}
                                />
                                <label htmlFor="consent" className="text-sm font-medium text-rose-500">Enable Live Trading Execution</label>
                            </div>
                        </div>
                    </div>

                    {/* Market Data Card */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-900">
                        <h3 className="mb-4 font-semibold">Active Monitoring</h3>
                        {isRunning ? (
                            <div className="space-y-4">
                                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-white/5">
                                    <span className="text-sm text-slate-500">ATM Strike</span>
                                    <span className="font-mono text-sm">{atmStrike || '-'}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-white/5">
                                    <span className="text-sm text-slate-500">CE Symbol</span>
                                    <span className="text-sm">{ceContract?.tradingsymbol || '-'}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-white/5">
                                    <span className="text-sm text-slate-500">PE Symbol</span>
                                    <span className="text-sm">{peContract?.tradingsymbol || '-'}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-white/5">
                                    <span className="text-sm text-slate-500">Last HA Close</span>
                                    <span className="font-mono text-sm">{lastHaClose?.toFixed(2) || '-'}</span>
                                </div>
                                {activeSignal && (
                                    <div className="mt-4 rounded-xl bg-cyan-400/10 p-4 border border-cyan-400/20">
                                        <p className="text-xs text-cyan-500 flex items-center justify-between">
                                            Active Signal <span>LTP: {currentLtp}</span>
                                        </p>
                                        <p className="text-lg font-bold text-cyan-600 uppercase">{activeSignal} Trade Detected</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex h-40 flex-col items-center justify-center text-slate-400">
                                <p>Start the strategy to see market monitoring data</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </StrategiesLayout>
    )
}
