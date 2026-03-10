import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play,
  Square,
  ChevronRight,
  Target,
  Clock,
  Activity,
  TrendingUp
} from 'lucide-react'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import {
  computePremiumRange,
  detectBreakoutCloseOnly,
  shouldProcessCandle,
  type BreakoutSide,
  type Candle
} from '../../trading/strategies/premiumRangeBreakout'
// import { computeStopLossAndTarget } from '../../trading/strategies/premiumRangeBreakout'
import { isStopLossExitReason, playSlAudio, primeSlAudio } from '../../shared/audio/slAudio'
import { apiGet, apiPost } from '../../trading'
import { usePageTitle } from '../../hooks/usePageTitle'

type Underlying = 'SENSEX' | 'NIFTY' | 'BANKNIFTY'
type Exchange = 'BFO' | 'NFO'

const INDEX_CONFIG: Record<Underlying, { qty: number, step: number, exchange: Exchange }> = {
  SENSEX: { qty: 10, step: 10, exchange: 'BFO' },
  NIFTY: { qty: 75, step: 75, exchange: 'NFO' },
  BANKNIFTY: { qty: 15, step: 15, exchange: 'NFO' },
}

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
  items: Candle[]
}

type StrategyState = 'WAITING' | 'SIGNAL' | 'IN_POSITION' | 'COOLDOWN' | 'EXITED' | 'STOPPED'
type StrikeMode = 'ATM' | 'ITM' | 'OTM'

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
    const next = mode === 'ITM' ? idx - steps : idx + steps
    return next >= 0 && next < sorted.length ? sorted[next] : null
  }

  const next = mode === 'ITM' ? idx + steps : idx - steps
  return next >= 0 && next < sorted.length ? sorted[next] : null
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
  usePageTitle('5 Min Breakout');
  const { connectStatus } = useAngelConnection()

  const [isRunning, setIsRunning] = useState<boolean>(() => getSavedState('fmb_isRunning', false))
  const [state, setState] = useState<StrategyState>(() => getSavedState('fmb_state', 'STOPPED'))
  const [message, setMessage] = useState<string>('')

  const [lookback, setLookback] = useState<4 | 5>(() => getSavedState('fmb_lookback', 5))
  const [underlying, setUnderlying] = useState<Underlying>(() => getSavedState('fmb_underlying', 'SENSEX'))
  const [exchange, setExchange] = useState<Exchange>(() => getSavedState('fmb_exchange', 'BFO'))
  const [quantity, setQuantity] = useState<number>(() => getSavedState('fmb_quantity', INDEX_CONFIG.SENSEX.qty))
  const [liveTradingConsent, setLiveTradingConsent] = useState(() => getSavedState('fmb_liveTradingConsent', false))

  // New Strategy Configuration Parameters
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

  const [targetPoints, setTargetPoints] = useState<number>(() => getSavedState('fmb_targetPoints', 20))
  const [bufferPoints, setBufferPoints] = useState<number>(() => getSavedState('fmb_bufferPoints', 2))
  const [maxRangeLimit, setMaxRangeLimit] = useState<number>(() => getSavedState('fmb_maxRangeLimit', 30))

  const [premiumMin, setPremiumMin] = useState<number>(() => getSavedState('fmb_premiumMin', 300))
  const [premiumMax, setPremiumMax] = useState<number>(() => getSavedState('fmb_premiumMax', 400))

  const [strikeMode, setStrikeMode] = useState<StrikeMode>(() => getSavedState('fmb_strikeMode', 'ATM'))
  const [strikeDepth, setStrikeDepth] = useState<number>(() => getSavedState('fmb_strikeDepth', 1))

  useEffect(() => {
    localStorage.setItem('fmb_isRunning', JSON.stringify(isRunning))
    localStorage.setItem('fmb_state', JSON.stringify(state))
    localStorage.setItem('fmb_lookback', JSON.stringify(lookback))
    localStorage.setItem('fmb_underlying', JSON.stringify(underlying))
    localStorage.setItem('fmb_exchange', JSON.stringify(exchange))
    localStorage.setItem('fmb_quantity', JSON.stringify(quantity))
    localStorage.setItem('fmb_targetPoints', JSON.stringify(targetPoints))
    localStorage.setItem('fmb_bufferPoints', JSON.stringify(bufferPoints))
    localStorage.setItem('fmb_maxRangeLimit', JSON.stringify(maxRangeLimit))
    localStorage.setItem('fmb_liveTradingConsent', JSON.stringify(liveTradingConsent))
    localStorage.setItem('fmb_strikeMode', JSON.stringify(strikeMode))
    localStorage.setItem('fmb_strikeDepth', JSON.stringify(strikeDepth))
    localStorage.setItem('fmb_premiumMin', JSON.stringify(premiumMin))
    localStorage.setItem('fmb_premiumMax', JSON.stringify(premiumMax))
  }, [isRunning, state, lookback, underlying, exchange, quantity, targetPoints, bufferPoints, maxRangeLimit, liveTradingConsent, strikeMode, strikeDepth, premiumMin, premiumMax])

  // Live Monitor State
  const [monitoredPremiums, setMonitoredPremiums] = useState<{ ce: string, pe: string }>({ ce: '---', pe: '---' })
  const [checkpoints, setCheckpoints] = useState([
    { id: 'broker', label: 'Broker Connection', status: 'pending' },
    { id: 'index_ltp', label: 'Index LTP Sync', status: 'pending' },
    { id: 'contracts', label: 'Options Discovery', status: 'pending' },
    { id: 'range', label: '5-Min Range Lock', status: 'pending' },
    { id: 'breakout', label: 'Breakout Vigil', status: 'pending' }
  ])

  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
  const [atmStrike, setAtmStrike] = useState<number | null>(null)
  const [ceContract, setCeContract] = useState<IndexOptionContract | null>(null)
  const [peContract, setPeContract] = useState<IndexOptionContract | null>(null)

  const [rangeSide, setRangeSide] = useState<BreakoutSide | null>(null)
  const [entryPrice, setEntryPrice] = useState<number | null>(null)
  const [stopLoss, setStopLoss] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [currentLtp, setCurrentLtp] = useState<number | null>(null)
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
  const [activeTradePremium, setActiveTradePremium] = useState<string | null>(null)

  const inFlightRef = useRef(false)
  const lastProcessedCandleTsRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)

  // Mirror activeTradeId so intervals can see the latest without re-running on every render
  const activeTradeRef = useRef<{ tradeId: string | null; premium: string | null }>({ tradeId: null, premium: null })

  const setActiveTrade = useCallback((tradeId: string | null, premium: string | null) => {
    activeTradeRef.current = { tradeId, premium }
    setActiveTradeId(tradeId)
    setActiveTradePremium(premium)
  }, [])

  const resetForNextRun = useCallback((nextState: StrategyState) => {
    inFlightRef.current = false
    lastProcessedCandleTsRef.current = null
    setMessage('')
    setState(nextState)
    setRangeSide(null)
    setEntryPrice(null)
    setStopLoss(null)
    setTarget(null)
    setCurrentLtp(null)
    setActiveTrade(null, null)
  }, [setActiveTrade])

  const stopStrategy = useCallback(() => {
    stopRequestedRef.current = true
    setIsRunning(false)
    setState('STOPPED')
    setMessage('Strategy stopped.')
    setMonitoredPremiums({ ce: '---', pe: '---' })
    setCheckpoints(prev => prev.map(cp => ({ ...cp, status: 'pending' })))
  }, [])

  const [isExiting, setIsExiting] = useState(false)

  const manualExitPosition = useCallback(async () => {
    const { tradeId, premium: activeSymbol } = activeTradeRef.current
    if (!tradeId || !activeSymbol || isExiting) return

    setIsExiting(true)
    setMessage('Manual exit initiated...')

    try {
      const contract = rangeSide === 'CE' ? ceContract : peContract

      let exitPx = currentLtp ?? entryPrice ?? 0
      if (contract) {
        try {
          const ltpRes = await apiGet<{ ltp: number }>(`/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`)
          if (ltpRes.ltp > 0) exitPx = ltpRes.ltp
        } catch (e) {
          console.warn('LTP fetch failed for manual exit', e)
        }
      }

      if (liveTradingConsent && contract) {
        try {
          const orderRes = await apiPost<any>('/angel/orders/simple', {
            exchange: contract.exchange,
            tradingsymbol: contract.tradingsymbol,
            symboltoken: contract.symboltoken,
            transactiontype: 'SELL',
            producttype: 'CARRYFORWARD',
            quantity: quantity,
            ordertype: 'MARKET',
          })
          const orderId = orderRes?.item?.response?.data?.orderid || orderRes?.item?.response?.orderid
          if (orderId) {
            for (let i = 0; i < 4; i++) {
              await new Promise(r => setTimeout(r, 1000))
              const ob = await apiGet<any>('/angel/orderbook')
              const order = (ob?.data || []).find((o: any) => String(o.orderid) === String(orderId))
              if (order && ['complete', 'executed'].includes(order.status || order.orderstatus)) {
                const execPrice = parseFloat(order.averageprice || order.price)
                if (!isNaN(execPrice) && execPrice > 0) {
                  exitPx = execPrice
                  break
                }
              }
            }
          }
        } catch (err) {
          console.error('LIVE SELL failed', err)
        }
      }

      await apiPost('/trades/update-exit', {
        tradeId,
        exitPrice: exitPx,
        exitReason: 'Strategy'
      })

      setMessage(`Manual exit @ ${exitPx} saved to DB.`)
      resetForNextRun('COOLDOWN')
      setTimeout(() => resetForNextRun('WAITING'), 60000)
    } catch (err) {
      console.error('Manual exit failed', err)
      setMessage('Manual exit failed. Check console.')
    } finally {
      setIsExiting(false)
    }
  }, [isExiting, rangeSide, ceContract, peContract, currentLtp, entryPrice, liveTradingConsent, quantity, resetForNextRun])

  const handleUnderlyingChange = (val: Underlying) => {
    setUnderlying(val)
    setExchange(INDEX_CONFIG[val].exchange)
    setQuantity(INDEX_CONFIG[val].qty)
  }

  const startStrategy = useCallback(() => {
    stopRequestedRef.current = false
    primeSlAudio()
    setIsRunning(true)
    resetForNextRun('WAITING')
  }, [resetForNextRun])

  useEffect(() => {
    if (connectStatus !== 'connected') {
      stopStrategy()
    }
  }, [connectStatus, stopStrategy])

  // Check for existing open trade on load
  useEffect(() => {
    if (connectStatus !== 'connected') return
    let disposed = false
    apiGet<{ data: { trade?: { _id: string, buyPrice: number, index: Underlying, strategyName: string, premium?: string } } }>(`/trades/latest-open?strategyName=5minBreakout`)
      .then(res => {
        if (disposed) return
        if (res.data?.trade) {
          const t = res.data.trade
          setActiveTrade(t._id, t.premium || null)
          setEntryPrice(t.buyPrice)

          // Optionally guess side by premium string if it exists
          if (t.premium) {
            if (t.premium.endsWith('CE')) setRangeSide('CE')
            else if (t.premium.endsWith('PE')) setRangeSide('PE')
          }
          setState('IN_POSITION')
          setMessage('Recovered active 5minBreakout trade.')
        }
      })
      .catch(console.error)
    return () => { disposed = true }
  }, [connectStatus, setActiveTrade])

  // Context-aware initialization
  useEffect(() => {
    if (!isRunning) return
    if (connectStatus !== 'connected') return

    let disposed = false
    async function loadContracts() {
      setMessage(`Analyzing ${underlying} contracts…`)
      try {
        const index = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(underlying)}`)
        const opt = await apiGet<IndexOptionsResponse>(
          `/instruments/index-options?exchange=${encodeURIComponent(exchange)}&underlying=${encodeURIComponent(underlying)}`,
        )

        const exp = pickNearestExpiry(opt.expiries)
        if (!exp) throw new Error('No expiries found')

        const strike = pickNearestStrike(opt.strikes, index.ltp)
        if (strike === null) throw new Error('ATM mismatch')

        if (disposed) return
        setSelectedExpiry(exp)
        setAtmStrike(strike)
        setMessage('Network connected. Resolving premium filters…')
      } catch (e) {
        if (disposed) return
        setMessage(e instanceof Error ? e.message : 'Initialization failed')
        setState('STOPPED')
        setIsRunning(false)
      }
    }
    loadContracts()
    return () => { disposed = true }
  }, [connectStatus, isRunning])

  // Contract management loop
  useEffect(() => {
    if (!isRunning || connectStatus !== 'connected' || !selectedExpiry || atmStrike === null) return

    let cancelled = false
    const tick = async () => {
      if (cancelled || inFlightRef.current) return
      inFlightRef.current = true
      try {
        const opt = await apiGet<IndexOptionsResponse>(
          `/instruments/index-options?exchange=${encodeURIComponent(exchange)}&underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(selectedExpiry)}`,
        )

        const ceStrike = resolveStrikeForSide({ strikes: opt.strikes, atmStrike, mode: strikeMode, depth: strikeDepth, side: 'CE' })
        const peStrike = resolveStrikeForSide({ strikes: opt.strikes, atmStrike, mode: strikeMode, depth: strikeDepth, side: 'PE' })

        if (ceStrike !== null && peStrike !== null) {
          const ce = opt.contracts.find((c) => Math.abs(c.strike - ceStrike) < 1e-6 && c.option_type === 'CE') ?? null
          const pe = opt.contracts.find((c) => Math.abs(c.strike - peStrike) < 1e-6 && c.option_type === 'PE') ?? null
          setCeContract(ce); setPeContract(pe)
          setMessage('Range monitoring active.')
        }
      } catch (e) {
        console.error(e)
      } finally { inFlightRef.current = false }
    }
    const t = setInterval(tick, 15000)
    tick()
    return () => { cancelled = true; clearInterval(t) }
  }, [atmStrike, connectStatus, exchange, isRunning, selectedExpiry, strikeDepth, strikeMode, underlying])

  // Sync Monitor and Checkpoints
  useEffect(() => {
    if (!isRunning) return

    setCheckpoints([
      { id: 'broker', label: 'Broker Connection', status: connectStatus === 'connected' ? 'success' : 'error' },
      { id: 'index_ltp', label: 'Index LTP Sync', status: atmStrike ? 'success' : 'pending' },
      { id: 'contracts', label: 'Options Discovery', status: (ceContract && peContract) ? 'success' : 'pending' },
      { id: 'range', label: '5-Min Range Lock', status: state !== 'WAITING' ? 'success' : 'pending' },
      { id: 'breakout', label: 'Breakout Vigil', status: state === 'WAITING' ? 'success' : 'pending' }
    ])

    if (ceContract && peContract) {
      setMonitoredPremiums({
        ce: ceContract.tradingsymbol,
        pe: peContract.tradingsymbol
      })
    }
  }, [isRunning, connectStatus, atmStrike, ceContract, peContract, state, underlying])

  // Scan loop
  useEffect(() => {
    if (!isRunning || connectStatus !== 'connected' || state !== 'WAITING' || !ceContract || !peContract) return
    if (activeTradeRef.current.tradeId) return // Single position per strategy check

    let cancelled = false
    const scan = async () => {
      if (cancelled || inFlightRef.current) return
      inFlightRef.current = true
      try {
        const [ceCandles, peCandles] = await Promise.all([
          apiGet<CandlesResponse>(`/market/candles?exchange=${encodeURIComponent(ceContract.exchange)}&symboltoken=${encodeURIComponent(ceContract.symboltoken)}&interval=ONE_MINUTE&lookback_minutes=20`),
          apiGet<CandlesResponse>(`/market/candles?exchange=${encodeURIComponent(peContract.exchange)}&symboltoken=${encodeURIComponent(peContract.symboltoken)}&interval=ONE_MINUTE&lookback_minutes=20`),
        ])

        const ceWindow = getLastCompletedCandleWindow(ceCandles.items ?? [], lookback)
        const peWindow = getLastCompletedCandleWindow(peCandles.items ?? [], lookback)
        if (!ceWindow || !peWindow) return

        const ceRange = computePremiumRange(ceWindow.rangeCandles, lookback, maxRangeLimit)
        const peRange = computePremiumRange(peWindow.rangeCandles, lookback, maxRangeLimit)

        const nextTs = ceWindow.breakoutCandle.ts
        if (!shouldProcessCandle({ lastProcessedTs: lastProcessedCandleTsRef.current, nextTs })) return
        lastProcessedCandleTsRef.current = nextTs

        const ceBreakout = ceRange ? detectBreakoutCloseOnly({ candleClose: ceWindow.breakoutCandle.close, range: ceRange }) : false
        const peBreakout = peRange ? detectBreakoutCloseOnly({ candleClose: peWindow.breakoutCandle.close, range: peRange }) : false

        if (ceBreakout || peBreakout) {
          const isCE = ceBreakout
          const contractToTrade = isCE ? ceContract : peContract
          let actualEntryPx = isCE ? ceWindow.breakoutCandle.close : peWindow.breakoutCandle.close
          const activeRange = isCE ? ceRange! : peRange!

          // Execute Live Entry
          if (liveTradingConsent) {
            try {
              const orderRes = await apiPost<any>('/angel/orders/simple', {
                exchange: contractToTrade.exchange,
                tradingsymbol: contractToTrade.tradingsymbol,
                symboltoken: contractToTrade.symboltoken,
                transactiontype: 'BUY',
                producttype: 'CARRYFORWARD',
                quantity: quantity,
                ordertype: 'MARKET',
              })
              const orderId = orderRes?.item?.response?.data?.orderid || orderRes?.item?.response?.orderid
              if (orderId) {
                for (let i = 0; i < 4; i++) {
                  await new Promise(r => setTimeout(r, 1000))
                  const ob = await apiGet<any>('/angel/orderbook')
                  const order = (ob?.data || []).find((o: any) => String(o.orderid) === String(orderId))
                  if (order && ['complete', 'executed'].includes(order.status || order.orderstatus)) {
                    const execPrice = parseFloat(order.averageprice || order.price)
                    if (!isNaN(execPrice) && execPrice > 0) {
                      actualEntryPx = execPrice
                      break
                    }
                  }
                }
              }
            } catch (err) {
              console.error('LIVE BUY failed', err)
            }
          }

          setEntryPrice(actualEntryPx)
          setStopLoss(activeRange.rangeLow - bufferPoints)
          setTarget(actualEntryPx + targetPoints)
          setRangeSide(isCE ? 'CE' : 'PE')
          setState('IN_POSITION')

          setActiveTrade(null, contractToTrade.tradingsymbol)

          // Record Trade to DB
          apiPost<{ data: { trade: { _id: string } } }>('/trades/record', {
            strategyName: '5minBreakout',
            index: underlying,
            premium: contractToTrade.tradingsymbol,
            qty: quantity,
            buyPrice: actualEntryPx
          }).then(res => {
            setActiveTrade(res.data.trade._id, contractToTrade.tradingsymbol)
          }).catch(console.error)
        }
      } catch (e) {
        console.error(e)
      } finally { inFlightRef.current = false }
    }
    const t = setInterval(scan, 7000)
    scan()
    return () => { cancelled = true; clearInterval(t) }
  }, [ceContract, connectStatus, isRunning, lookback, peContract, state, underlying, quantity, maxRangeLimit, bufferPoints, targetPoints, liveTradingConsent, setActiveTrade])

  // Position Monitoring Loop
  useEffect(() => {
    if (!isRunning || state !== 'IN_POSITION' || !activeTradeRef.current.tradeId) return

    // Ensure SL audio is primed (covers recovery-on-load case)
    primeSlAudio()

    let cancelled = false
    const monitor = async () => {
      if (cancelled || inFlightRef.current) return
      inFlightRef.current = true
      try {
        const activeToken = rangeSide === 'CE' ? ceContract?.symboltoken : peContract?.symboltoken
        const activeExchange = rangeSide === 'CE' ? ceContract?.exchange : peContract?.exchange
        const activeTs = rangeSide === 'CE' ? ceContract?.tradingsymbol : peContract?.tradingsymbol
        const currentRef = activeTradeRef.current

        if (!activeToken || !activeExchange || !currentRef.tradeId) return

        const res = await apiGet<{ ltp: number }>(`/market/ltp?exchange=${encodeURIComponent(activeExchange)}&tradingsymbol=${encodeURIComponent(activeTs || '')}&symboltoken=${encodeURIComponent(activeToken)}`)
        if (cancelled) return

        const ltp = res.ltp
        setCurrentLtp(ltp)

        let exitPrice: number | null = null
        let exitReason: string | null = null

        if (stopLoss && ltp <= stopLoss) {
          exitPrice = ltp
          exitReason = 'SL'
        } else if (target && ltp >= target) {
          exitPrice = ltp
          exitReason = 'Target'
        }

        if (exitPrice && exitReason) {
          let actualExitPx = exitPrice

          if (liveTradingConsent) {
            try {
              const orderRes = await apiPost<any>('/angel/orders/simple', {
                exchange: activeExchange,
                tradingsymbol: activeTs,
                symboltoken: activeToken,
                transactiontype: 'SELL',
                producttype: 'CARRYFORWARD',
                quantity: quantity,
                ordertype: 'MARKET',
              })
              const orderId = orderRes?.item?.response?.data?.orderid || orderRes?.item?.response?.orderid
              if (orderId) {
                for (let i = 0; i < 4; i++) {
                  await new Promise(r => setTimeout(r, 1000))
                  const ob = await apiGet<any>('/angel/orderbook')
                  const order = (ob?.data || []).find((o: any) => String(o.orderid) === String(orderId))
                  if (order && ['complete', 'executed'].includes(order.status || order.orderstatus)) {
                    const execPrice = parseFloat(order.averageprice || order.price)
                    if (!isNaN(execPrice) && execPrice > 0) {
                      actualExitPx = execPrice
                      break
                    }
                  }
                }
              }
            } catch (err) {
              console.error('LIVE SELL failed', err)
            }
          }

          if (isStopLossExitReason(exitReason)) {
            playSlAudio()
          }
          await apiPost('/trades/update-exit', {
            tradeId: currentRef.tradeId,
            exitPrice: actualExitPx,
            exitReason
          })
          setMessage(`${exitReason} hit @ ${actualExitPx}`)
          resetForNextRun('COOLDOWN')
          setTimeout(() => resetForNextRun('WAITING'), 60000) // 1 min cooldown
        }
      } catch (e) {
        console.error('Monitor error:', e)
      } finally { inFlightRef.current = false }
    }

    const t = setInterval(monitor, 1000)
    monitor()
    return () => { cancelled = true; clearInterval(t) }
  }, [ceContract, peContract, isRunning, rangeSide, state, stopLoss, target, resetForNextRun, liveTradingConsent, quantity])

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Control Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50' : 'bg-slate-300'}`} />
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Breakout Engine</h2>
            </div>
            <p className="text-sm font-medium text-slate-500 max-w-md">
              {message || `Scanning for premium range spikes on ${underlying} 5m candles.`}
            </p>
            <div className="flex items-center gap-8 pt-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Current state</p>
                <p className="text-sm font-black text-slate-700 dark:text-slate-200">{state}</p>
              </div>
              <div className="h-8 w-px bg-slate-100 dark:bg-white/5" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Network Status</p>
                <p className={`text-sm font-black ${connectStatus === 'connected' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {connectStatus.toUpperCase()}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {state === 'IN_POSITION' && activeTradeId && (
              <button
                disabled={isExiting}
                onClick={manualExitPosition}
                className="flex items-center gap-2 px-6 py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-orange-500/20 active:scale-95"
              >
                Exit Position
              </button>
            )}
            {!isRunning ? (
              <button
                onClick={startStrategy}
                disabled={connectStatus !== 'connected'}
                className="flex items-center gap-2 px-8 py-4 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-cyan-500/20 active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" />
                Launch Scanner
              </button>
            ) : (
              <button
                onClick={stopStrategy}
                className="flex items-center gap-2 px-8 py-4 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-rose-500/20 active:scale-95"
              >
                <Square className="w-4 h-4 fill-current" />
                Halt Execution
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
              <Clock className="w-4 h-4" />
              Scanning Parameters
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
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Premium Lookback</label>
                  <select
                    value={lookback}
                    onChange={(e) => setLookback(Number(e.target.value) as 4 | 5)}
                    disabled={isRunning}
                    className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value={4}>4 Candles (Fast)</option>
                    <option value={5}>5 Candles (Balanced)</option>
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
                    className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block truncate">Target (Pts)</label>
                    <input
                      type="number"
                      value={targetPoints}
                      onChange={(e) => setTargetPoints(parseFloat(e.target.value) || 0)}
                      disabled={isRunning}
                      className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block truncate">SL Buffer</label>
                    <input
                      type="number"
                      value={bufferPoints}
                      onChange={(e) => setBufferPoints(parseFloat(e.target.value) || 0)}
                      disabled={isRunning}
                      className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-black text-rose-500 dark:text-rose-400 outline-none focus:ring-2 focus:ring-rose-500/20 transition-all font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block truncate">Max Limit</label>
                    <input
                      type="number"
                      value={maxRangeLimit}
                      onChange={(e) => setMaxRangeLimit(parseFloat(e.target.value) || 0)}
                      disabled={isRunning}
                      className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-sm font-black text-cyan-500 dark:text-cyan-400 outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-3xl border border-transparent">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Live Execution</h4>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-500">Authorize Orders</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={liveTradingConsent}
                        onChange={(e) => setLiveTradingConsent(e.target.checked)}
                        disabled={isRunning}
                        className="sr-only peer disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Trading Panel */}
          {state !== 'STOPPED' && (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm animate-in zoom-in duration-300">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-500">Live Trade Metrics</h3>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping" />
                  <span className="text-[10px] font-black text-slate-400">Monitoring Premium High/Low</span>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-8">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Premium LTP</p>
                  <p className="text-xl font-black text-slate-900 dark:text-white mt-1">₹{currentLtp?.toFixed(2) || '---'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Entry Trigger</p>
                  <p className="text-xl font-black text-slate-900 dark:text-white mt-1">₹{entryPrice?.toFixed(2) || '---'}</p>
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
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Stop Loss</p>
                  <p className="text-xl font-black text-rose-500 mt-1">₹{stopLoss?.toFixed(2) || '---'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Target</p>
                  <p className="text-xl font-black text-emerald-500 mt-1">₹{target?.toFixed(2) || '---'}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Side Selection */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm p-8">
            <h3 className="text-[10px] items-center gap-2 font-black uppercase tracking-[0.2em] text-slate-400 mb-8 flex">
              <Target className="w-4 h-4" />
              Strike Config
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
                        : 'bg-slate-50 dark:bg-white/5 text-slate-400 hover:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {strikeMode !== 'ATM' && (
                <div className="animate-in slide-in-from-top-2 duration-300">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Strike Depth</label>
                  <div className="flex items-center justify-between p-1 bg-slate-50 dark:bg-white/5 rounded-xl">
                    <button
                      onClick={() => setStrikeDepth(Math.max(1, strikeDepth - 1))}
                      disabled={isRunning}
                      className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-cyan-500 font-black text-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >-</button>
                    <span className="text-sm font-black text-slate-900 dark:text-white">{strikeDepth}</span>
                    <button
                      onClick={() => setStrikeDepth(strikeDepth + 1)}
                      disabled={isRunning}
                      className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-cyan-500 font-black text-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >+</button>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Premium Band</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={premiumMin}
                    onChange={(e) => setPremiumMin(Number(e.target.value))}
                    disabled={isRunning}
                    className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Min"
                  />
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                  <input
                    type="number"
                    value={premiumMax}
                    onChange={(e) => setPremiumMax(Number(e.target.value))}
                    disabled={isRunning}
                    className="w-full bg-slate-50 dark:bg-white/5 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Max"
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
                Live Breakout Monitor
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`border rounded-2xl p-6 backdrop-blur-xl transition-all ${activeTradePremium === ceContract?.tradingsymbol
                    ? 'bg-cyan-500/20 border-cyan-500/40'
                    : 'bg-white/5 border-white/10'
                    }`}>
                  <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-3">Analyzed CE</p>
                  {activeTradePremium === ceContract?.tradingsymbol && (
                    <p className="text-[9px] font-black text-cyan-400 uppercase tracking-widest mb-2">● ACTIVE TRADE</p>
                  )}
                  <p className="text-xl font-black text-white">{monitoredPremiums.ce}</p>
                </div>
                <div className={`border rounded-2xl p-6 backdrop-blur-xl transition-all ${activeTradePremium === peContract?.tradingsymbol
                    ? 'bg-rose-500/20 border-rose-500/40'
                    : 'bg-white/5 border-white/10'
                    }`}>
                  <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-3">Analyzed PE</p>
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
                    <div className={`w-2 h-2 rounded-full ${cp.status === 'success' ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : cp.status === 'error' ? 'bg-rose-500' : 'bg-white/20'}`} />
                    <span className="text-[11px] font-bold text-white/60 uppercase">{cp.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:w-80 bg-cyan-500/10 border border-cyan-500/20 rounded-3xl p-8 flex flex-col justify-center text-center">
            <TrendingUp className="w-12 h-12 text-cyan-500 mx-auto mb-4" />
            <h4 className="text-lg font-black text-white mb-2">Breakout Logic</h4>
            <p className="text-xs text-white/60 font-medium leading-relaxed">
              Scanning high-frequency premium candles. Signal generated only on volume-supported range breakouts.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
