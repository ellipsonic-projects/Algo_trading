import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import DashboardPage from '../DashboardPage/DashboardPage'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import StrategiesLayout from './StrategiesLayout'
import {
  computePremiumRange,
  computeStopLossAndTarget,
  detectBreakoutCloseOnly,
  shouldProcessCandle,
  type BreakoutSide,
  type Candle,
  type RangeSnapshot,
} from '../../trading/strategies/premiumRangeBreakout'

type Underlying = 'SENSEX'
type Exchange = 'BFO'

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

const ENABLE_ORDER_PLACEMENT = false

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

function isSuccessResponse(resp: Record<string, unknown> | null | undefined): boolean {
  if (!resp) return false
  const status = resp.status
  if (typeof status === 'boolean') return status
  const data = resp.data
  if (data && typeof data === 'object') {
    const orderid = (data as Record<string, unknown>).orderid
    if (typeof orderid === 'string' && orderid.trim().length > 0) return true
  }
  return false
}

function extractOrderId(resp: Record<string, unknown> | null | undefined): string | null {
  if (!resp) return null
  const data = resp.data
  if (data && typeof data === 'object') {
    const orderid = (data as Record<string, unknown>).orderid
    if (typeof orderid === 'string' && orderid.trim()) return orderid.trim()
  }
  return null
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

function parseCandleTsMs(ts: string): number | null {
  const raw = String(ts || '').trim()
  if (!raw) return null

  const direct = Date.parse(raw)
  if (Number.isFinite(direct)) return direct

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null

  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const hh = Number(m[4])
  const mm = Number(m[5])
  const ss = m[6] ? Number(m[6]) : 0
  if (![y, mo, d, hh, mm, ss].every((v) => Number.isFinite(v))) return null

  return new Date(y, mo, d, hh, mm, ss, 0).getTime()
}

function getLastCompletedCandleWindow(candles: Candle[], lookback: 4 | 5): { rangeCandles: Candle[]; breakoutCandle: Candle } | null {
  if (!Array.isArray(candles) || candles.length < lookback + 1) return null

  const now = new Date()
  now.setSeconds(0, 0)
  const currentMinuteStartMs = now.getTime()

  const completed = candles.filter((c) => {
    const ms = parseCandleTsMs(c.ts)
    if (ms === null) return false
    return ms < currentMinuteStartMs
  })

  if (completed.length < lookback + 1) return null

  const breakoutCandle = completed[completed.length - 1]
  const rangeCandles = completed.slice(completed.length - (lookback + 1), completed.length - 1)
  if (rangeCandles.length !== lookback) return null
  return { rangeCandles, breakoutCandle }
}

export default function FiveMinBreakoutPage() {
  const { connectStatus } = useAngelConnection()

  const [isRunning, setIsRunning] = useState(false)
  const [state, setState] = useState<StrategyState>('STOPPED')
  const [message, setMessage] = useState<string>('')

  const [lookback, setLookback] = useState<4 | 5>(5)
  const [quantity, setQuantity] = useState<number>(10)

  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
  const [ceContract, setCeContract] = useState<IndexOptionContract | null>(null)
  const [peContract, setPeContract] = useState<IndexOptionContract | null>(null)

  const [range, setRange] = useState<RangeSnapshot | null>(null)
  const [rangeSide, setRangeSide] = useState<BreakoutSide | null>(null)
  const [breakoutClose, setBreakoutClose] = useState<number | null>(null)

  const [entryPrice, setEntryPrice] = useState<number | null>(null)
  const [stopLoss, setStopLoss] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [currentLtp, setCurrentLtp] = useState<number | null>(null)

  const [signalContract, setSignalContract] = useState<IndexOptionContract | null>(null)

  const [entryOrderId, setEntryOrderId] = useState<string | null>(null)
  const [slOrderId, setSlOrderId] = useState<string | null>(null)
  const [usedRangeKey, setUsedRangeKey] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const lastProcessedCandleTsRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)

  const activeContract = useMemo(() => {
    if (rangeSide === 'CE') return ceContract
    if (rangeSide === 'PE') return peContract
    return null
  }, [ceContract, peContract, rangeSide])

  const normalizedQuantity = useMemo(() => {
    const lot = activeContract?.lot_size ?? ceContract?.lot_size ?? peContract?.lot_size ?? null
    if (lot && Number.isFinite(lot) && lot > 0) {
      if (!Number.isFinite(quantity) || quantity <= 0) return lot
      const q = Math.max(lot, Math.round(quantity / lot) * lot)
      return q
    }
    return Math.max(1, Math.floor(quantity))
  }, [activeContract?.lot_size, ceContract?.lot_size, peContract?.lot_size, quantity])

  const resetForNextRun = useCallback((nextState: StrategyState) => {
    inFlightRef.current = false
    lastProcessedCandleTsRef.current = null
    setMessage('')
    setState(nextState)
    setRange(null)
    setRangeSide(null)
    setBreakoutClose(null)
    setEntryPrice(null)
    setStopLoss(null)
    setTarget(null)
    setCurrentLtp(null)
    setEntryOrderId(null)
    setSlOrderId(null)
    setSignalContract(null)
  }, [])

  const resetSignalAndResume = useCallback(() => {
    resetForNextRun('WAITING')
    setMessage('Reset complete. Waiting for next valid range…')
  }, [resetForNextRun])

  const stopStrategy = useCallback(() => {
    stopRequestedRef.current = true
    setIsRunning(false)
    setState('STOPPED')
    setMessage('Strategy stopped. No scanning or auto-management is running.')
  }, [])

  const startStrategy = useCallback(() => {
    stopRequestedRef.current = false
    setIsRunning(true)
    resetForNextRun('WAITING')
  }, [resetForNextRun])

  useEffect(() => {
    if (connectStatus !== 'connected') {
      stopStrategy()
    }
  }, [connectStatus, stopStrategy])

  useEffect(() => {
    if (!isRunning) return
    if (connectStatus !== 'connected') return

    let disposed = false
    async function loadContracts() {
      setMessage('Loading SENSEX contracts…')
      try {
        const index = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent('SENSEX')}`)
        const opt = await apiGet<IndexOptionsResponse>(
          `/instruments/index-options?exchange=${encodeURIComponent('BFO')}&underlying=${encodeURIComponent('SENSEX')}`,
        )

        const exp = pickNearestExpiry(opt.expiries)
        if (!exp) throw new Error('No expiries found for SENSEX')

        const strike = pickNearestStrike(opt.strikes, index.ltp)
        if (strike === null) throw new Error('Unable to pick ATM strike')

        const eps = 1e-6
        const ce = opt.contracts.find((c) => c.expiry === exp && Math.abs(c.strike - strike) < eps && c.option_type === 'CE') ?? null
        const pe = opt.contracts.find((c) => c.expiry === exp && Math.abs(c.strike - strike) < eps && c.option_type === 'PE') ?? null
        if (!ce || !pe) throw new Error('ATM CE/PE contracts not found for selected expiry/strike')

        if (disposed) return
        setSelectedExpiry(exp)
        setSelectedStrike(strike)
        setCeContract(ce)
        setPeContract(pe)
        setMessage('Contracts ready. Waiting for valid range…')
      } catch (e) {
        if (disposed) return
        const msg = e instanceof Error ? e.message : 'Unable to load contracts'
        setMessage(msg)
        setState('STOPPED')
        setIsRunning(false)
      }
    }

    void loadContracts()
    return () => {
      disposed = true
    }
  }, [connectStatus, isRunning])

  useEffect(() => {
    if (!isRunning) return
    if (connectStatus !== 'connected') return
    if (state !== 'WAITING') return
    if (!ceContract || !peContract) return

    let cancelled = false
    const intervalMs = 7000

    async function scanOnce() {
      if (cancelled) return
      if (stopRequestedRef.current) return
      if (inFlightRef.current) return
      if (!ceContract || !peContract) return

      inFlightRef.current = true
      try {
        const lb = 20

        const [ceCandles, peCandles] = await Promise.all([
          apiGet<CandlesResponse>(
            `/market/candles?exchange=${encodeURIComponent(ceContract.exchange)}&symboltoken=${encodeURIComponent(ceContract.symboltoken)}&interval=ONE_MINUTE&lookback_minutes=${lb}`,
          ),
          apiGet<CandlesResponse>(
            `/market/candles?exchange=${encodeURIComponent(peContract.exchange)}&symboltoken=${encodeURIComponent(peContract.symboltoken)}&interval=ONE_MINUTE&lookback_minutes=${lb}`,
          ),
        ])

        if (cancelled) return

        const ceWindow = getLastCompletedCandleWindow(ceCandles.items ?? [], lookback)
        const peWindow = getLastCompletedCandleWindow(peCandles.items ?? [], lookback)
        if (!ceWindow || !peWindow) {
          setMessage('Waiting for enough completed 1-minute candles…')
          return
        }

        const ceRange = computePremiumRange(ceWindow.rangeCandles, lookback)
        const peRange = computePremiumRange(peWindow.rangeCandles, lookback)
        if (!ceRange || !peRange) {
          setMessage('Unable to compute range…')
          return
        }

        const ceTs = ceWindow.breakoutCandle.ts
        const peTs = peWindow.breakoutCandle.ts
        const nextTs = ceTs <= peTs ? ceTs : peTs

        if (!shouldProcessCandle({ lastProcessedTs: lastProcessedCandleTsRef.current, nextTs })) {
          return
        }
        lastProcessedCandleTsRef.current = nextTs

        const ceBreak = detectBreakoutCloseOnly({ candleClose: ceWindow.breakoutCandle.close, range: ceRange })
        const peBreak = detectBreakoutCloseOnly({ candleClose: peWindow.breakoutCandle.close, range: peRange })

        const ceBreakout = ceBreak === 'CE'
        const peBreakout = peBreak === 'PE'

        const usedKey = usedRangeKey
        const ceKey = `SENSEX|${ceContract.expiry}|${ceContract.strike}|CE|${ceRange.rangeLow}|${ceRange.rangeHigh}`
        const peKey = `SENSEX|${peContract.expiry}|${peContract.strike}|PE|${peRange.rangeLow}|${peRange.rangeHigh}`

        const ceAllowed = ceRange.isValid && usedKey !== ceKey
        const peAllowed = peRange.isValid && usedKey !== peKey

        if (!ceAllowed && !peAllowed) {
          setRange(null)
          setMessage('Range invalid or already used. Waiting for new range…')
          return
        }

        const selected: { side: BreakoutSide; window: { breakoutCandle: Candle }; snapshot: RangeSnapshot; key: string } | null =
          ceBreakout && ceAllowed && peBreakout && peAllowed
            ? ceTs < peTs
              ? { side: 'CE', window: ceWindow, snapshot: ceRange, key: ceKey }
              : { side: 'PE', window: peWindow, snapshot: peRange, key: peKey }
            : ceBreakout && ceAllowed
              ? { side: 'CE', window: ceWindow, snapshot: ceRange, key: ceKey }
              : peBreakout && peAllowed
                ? { side: 'PE', window: peWindow, snapshot: peRange, key: peKey }
                : null

        if (!selected) {
          const bestSnapshot = ceAllowed ? ceRange : peRange
          setRange(bestSnapshot)
          setRangeSide(null)
          setBreakoutClose(null)
          setMessage(bestSnapshot.isValid ? 'Range valid. Waiting for breakout close…' : 'Range too wide. Waiting…')
          return
        }

        setRange(selected.snapshot)
        setRangeSide(selected.side)
        setBreakoutClose(selected.window.breakoutCandle.close)
        setUsedRangeKey(selected.key)

        const contract = selected.side === 'CE' ? ceContract : peContract
        setSignalContract(contract)

        setMessage(`Breakout confirmed (${selected.side}). Signal generated (no orders will be placed).`)

        const ltpNow = await apiGet<LtpResponse>(
          `/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`,
        )
        setCurrentLtp(ltpNow.ltp)
        setEntryPrice(ltpNow.ltp)

        const slt = computeStopLossAndTarget({ entryPrice: ltpNow.ltp, rangeLow: selected.snapshot.rangeLow })
        if (!slt) {
          setMessage('Unable to compute SL/target. Strategy stopped.')
          setState('STOPPED')
          setIsRunning(false)
          return
        }
        setStopLoss(slt.stopLoss)
        setTarget(slt.target)

        setEntryOrderId(null)
        setSlOrderId(null)
        setState('SIGNAL')

        if (ENABLE_ORDER_PLACEMENT) {
          setMessage(`Breakout confirmed (${selected.side}). Placing entry…`)

          const entryResp = await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
            exchange: contract.exchange,
            tradingsymbol: contract.tradingsymbol,
            symboltoken: contract.symboltoken,
            transactiontype: 'BUY',
            producttype: 'INTRADAY',
            quantity: normalizedQuantity,
            ordertype: 'MARKET',
          })

          const okEntry = isSuccessResponse(entryResp.item.response)
          if (!okEntry) {
            setMessage('Entry order rejected by broker.')
            setState('EXITED')
            return
          }

          const oid = extractOrderId(entryResp.item.response)
          setEntryOrderId(oid)

          setMessage('Placing SL order…')
          const slResp = await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
            exchange: contract.exchange,
            tradingsymbol: contract.tradingsymbol,
            symboltoken: contract.symboltoken,
            transactiontype: 'SELL',
            producttype: 'INTRADAY',
            quantity: normalizedQuantity,
            ordertype: 'SL',
            triggerprice: slt.stopLoss,
          })

          const okSl = isSuccessResponse(slResp.item.response)
          if (!okSl) {
            setMessage('SL order rejected. Strategy stopped to avoid unmanaged position.')
            setState('STOPPED')
            setIsRunning(false)
            return
          }
          const slOid = extractOrderId(slResp.item.response)
          setSlOrderId(slOid)

          setState('IN_POSITION')
          setMessage('In position. Monitoring target/SL…')
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Scan failed'
        setMessage(msg)
      } finally {
        inFlightRef.current = false
      }
    }

    const t = window.setInterval(() => {
      void scanOnce()
    }, intervalMs)
    void scanOnce()

    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [ceContract, connectStatus, isRunning, lookback, normalizedQuantity, peContract, state, usedRangeKey])

  useEffect(() => {
    if (!isRunning) return
    if (connectStatus !== 'connected') return
    if (state !== 'IN_POSITION') return
    if (!activeContract || entryPrice === null || stopLoss === null || target === null) return

    let cancelled = false
    const intervalMs = 2500

    const contract = activeContract
    const stopLossValue = stopLoss
    const targetValue = target

    async function tick() {
      if (cancelled) return
      if (stopRequestedRef.current) return

      try {
        const ltpNow = await apiGet<LtpResponse>(
          `/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`,
        )
        if (cancelled) return
        setCurrentLtp(ltpNow.ltp)

        if (ltpNow.ltp >= targetValue) {
          setMessage('Target hit. Exiting and cancelling SL…')
          await apiPost<PlaceOrderResponse>('/angel/positions/exit', {
            exchange: contract.exchange,
            tradingsymbol: contract.tradingsymbol,
            symboltoken: contract.symboltoken,
            quantity: normalizedQuantity,
            producttype: 'INTRADAY',
            transactiontype: 'SELL',
          })
          if (slOrderId) {
            try {
              await apiPost<Record<string, unknown>>(`/angel/orders/${encodeURIComponent(slOrderId)}/cancel`, { variety: 'NORMAL' })
            } catch {
              // ignore
            }
          }
          setState('EXITED')
          setMessage('Exited on target. Waiting…')
          return
        }

        if (ltpNow.ltp <= stopLossValue) {
          setState('EXITED')
          setMessage('SL level hit. Strategy reset (no re-entry in same range).')
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'LTP monitor failed'
        setMessage(msg)
      }
    }

    const t = window.setInterval(() => {
      void tick()
    }, intervalMs)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [activeContract, connectStatus, entryPrice, isRunning, normalizedQuantity, slOrderId, state, stopLoss, target])

  useEffect(() => {
    // EXITED state is retained for future auto-management mode; signal-only mode uses SIGNAL and manual reset.
    if (!isRunning) return
    if (state !== 'EXITED') return
    if (stopRequestedRef.current) return

    const t = window.setTimeout(() => {
      resetForNextRun('WAITING')
      setMessage('Reset complete. Waiting for next valid range…')
    }, 3000)
    return () => {
      window.clearTimeout(t)
    }
  }, [isRunning, resetForNextRun, state])

  return (
    <StrategiesLayout
      title="5 min breakout"
      subtitle="1-minute Premium Range Breakout (SENSEX options)"
      backTo="/strategies"
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Strategy Controls</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{message || 'Ready.'}</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              State: <span className="font-semibold">{state}</span>
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startStrategy}
                disabled={connectStatus !== 'connected' || isRunning}
                className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-70"
              >
                Start
              </button>
              <button
                type="button"
                onClick={stopStrategy}
                disabled={!isRunning}
                className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-70 dark:border-white/10 dark:hover:bg-white/10"
              >
                Stop
              </button>
              <button
                type="button"
                onClick={resetSignalAndResume}
                disabled={!isRunning || state === 'WAITING' || state === 'IN_POSITION'}
                className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-70 dark:border-white/10 dark:hover:bg-white/10"
              >
                Reset
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Stop disables scanning and auto-management. If you stop while in position, manage the trade manually.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-950">
            <h3 className="text-sm font-semibold">Setup</h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs text-slate-500 dark:text-slate-400">Lookback candles</span>
                <select
                  value={lookback}
                  onChange={(e) => setLookback(e.target.value === '4' ? 4 : 5)}
                  disabled={isRunning}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
                >
                  <option value={5}>5</option>
                  <option value={4}>4</option>
                </select>
              </label>

              <label className="text-sm">
                <span className="block text-xs text-slate-500 dark:text-slate-400">Quantity</span>
                <input
                  value={String(quantity)}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  disabled={isRunning}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
                />
              </label>
            </div>
            <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              <p>
                Underlying: <span className="font-medium">SENSEX</span>
              </p>
              <p>
                Expiry: <span className="font-medium">{selectedExpiry ?? '—'}</span>
              </p>
              <p>
                Strike: <span className="font-medium">{selectedStrike ?? '—'}</span>
              </p>
              <p>
                CE: <span className="font-medium">{ceContract?.tradingsymbol ?? '—'}</span>
              </p>
              <p>
                PE: <span className="font-medium">{peContract?.tradingsymbol ?? '—'}</span>
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-950">
            <h3 className="text-sm font-semibold">Range / Breakout</h3>
            <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              <p>
                Option type: <span className="font-medium">{rangeSide ?? '—'}</span>
              </p>
              <p>
                Range High: <span className="font-medium">{range ? range.rangeHigh.toFixed(2) : '—'}</span>
              </p>
              <p>
                Range Low: <span className="font-medium">{range ? range.rangeLow.toFixed(2) : '—'}</span>
              </p>
              <p>
                Range size: <span className="font-medium">{range ? range.size.toFixed(2) : '—'}</span>
              </p>
              <p>
                Breakout close: <span className="font-medium">{breakoutClose === null ? '—' : breakoutClose.toFixed(2)}</span>
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-950">
            <h3 className="text-sm font-semibold">Trade</h3>
            <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              <p>
                Premium: <span className="font-medium">{signalContract ? `${signalContract.strike} ${signalContract.option_type} (${signalContract.expiry})` : '—'}</span>
              </p>
              <p>
                Trading symbol: <span className="font-medium">{signalContract?.tradingsymbol ?? '—'}</span>
              </p>
              <p>
                Entry: <span className="font-medium">{entryPrice === null ? '—' : entryPrice.toFixed(2)}</span>
              </p>
              <p>
                Stop Loss: <span className="font-medium">{stopLoss === null ? '—' : stopLoss.toFixed(2)}</span>
              </p>
              <p>
                Target: <span className="font-medium">{target === null ? '—' : target.toFixed(2)}</span>
              </p>
              <p>
                Current LTP: <span className="font-medium">{currentLtp === null ? '—' : currentLtp.toFixed(2)}</span>
              </p>
              <p>
                Entry order: <span className="font-medium">{entryOrderId ?? '—'}</span>
              </p>
              <p>
                SL order: <span className="font-medium">{slOrderId ?? '—'}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <DashboardPage hideHeader />
      </div>
    </StrategiesLayout>
  )
}
