import { useEffect, useState } from 'react'
import {
  Play,
  Square,
  Clock
} from 'lucide-react'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import { apiGet, apiPost } from '../../trading'
import { usePageTitle } from '../../hooks/usePageTitle'

type Underlying = 'SENSEX' | 'NIFTY' | 'BANKNIFTY'
type Exchange = 'BSE' | 'NFO'

const INDEX_CONFIG: Record<Underlying, { qty: number, step: number, exchange: Exchange }> = {
  SENSEX: { qty: 10, step: 10, exchange: 'BSE' },
  NIFTY: { qty: 75, step: 75, exchange: 'NFO' },
  BANKNIFTY: { qty: 15, step: 15, exchange: 'NFO' },
}

type StrategyState = 'WAITING' | 'SIGNAL' | 'IN_POSITION' | 'COOLDOWN' | 'EXITED' | 'STOPPED'
type StrikeMode = 'ATM' | 'ITM' | 'OTM'

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

export default function FiveMinBreakoutPage() {
  usePageTitle('5 Min Breakout')
  const { connectStatus } = useAngelConnection()

  const [isRunning, setIsRunning] = useState<boolean>(() => getSavedState('fmb_isRunning', false))
  const [state, setState] = useState<StrategyState>(() => getSavedState('fmb_state', 'STOPPED'))
  const [message, setMessage] = useState<string>('')

  const [lookback, setLookback] = useState<4 | 5>(() => getSavedState('fmb_lookback', 5))
  const [underlying, setUnderlying] = useState<Underlying>(() => getSavedState('fmb_underlying', 'SENSEX'))
  const [exchange, setExchange] = useState<Exchange>(() => getSavedState('fmb_exchange', 'BSE'))
  const [quantity, setQuantity] = useState<number>(() => getSavedState('fmb_quantity', INDEX_CONFIG.SENSEX.qty))
  const [liveTradingConsent, setLiveTradingConsent] = useState(() => getSavedState('fmb_liveTradingConsent', false))

  const [targetPoints, setTargetPoints] = useState<number>(() => getSavedState('fmb_targetPoints', 20))
  const [bufferPoints, setBufferPoints] = useState<number>(() => getSavedState('fmb_bufferPoints', 2))
  const [maxRangeLimit, setMaxRangeLimit] = useState<number>(() => getSavedState('fmb_maxRangeLimit', 30))

  const [premiumMin] = useState<number>(() => getSavedState('fmb_premiumMin', 300))
  const [premiumMax] = useState<number>(() => getSavedState('fmb_premiumMax', 400))

  const [strikeMode] = useState<StrikeMode>(() => getSavedState('fmb_strikeMode', 'ATM'))
  const [strikeDepth] = useState<number>(() => getSavedState('fmb_strikeDepth', 1))

  // Live Monitor State from Backend
  const [monitoredPremiums, setMonitoredPremiums] = useState<{ ce: string, pe: string }>({ ce: '---', pe: '---' })
  const [checkpoints, setCheckpoints] = useState([
    { id: 'broker', label: 'Broker Connection', status: 'pending' },
    { id: 'index_ltp', label: 'Index LTP Sync', status: 'pending' },
    { id: 'contracts', label: 'Options Discovery', status: 'pending' },
    { id: 'range', label: '5-Min Range Lock', status: 'pending' },
    { id: 'breakout', label: 'Breakout Vigil', status: 'pending' }
  ])

  const [entryPrice, setEntryPrice] = useState<number | null>(null)
  const [stopLoss, setStopLoss] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [currentLtp, setCurrentLtp] = useState<number | null>(null)
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
  const [isExiting, setIsExiting] = useState(false)

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

  // Poll Backend Status
  useEffect(() => {
    let active = true

    const fetchStatus = async () => {
      try {
        const res = await apiGet<{
          data: {
            isRunning: boolean
            state: StrategyState
            message: string
            monitoredPremiums: { ce: string, pe: string }
            checkpoints: Array<{ id: string, label: string, status: string }>
            activeTradeId: string | null
            entryPrice: number | null
            currentLtp: number | null
            stopLoss: number | null
            target: number | null
          }
        }>('/strategies/5minBreakout/status')

        if (!active || !res.data) return

        const d = res.data
        setIsRunning(d.isRunning)
        setState(d.state)
        if (d.message) setMessage(d.message)
        if (d.monitoredPremiums) setMonitoredPremiums(d.monitoredPremiums)
        if (d.checkpoints) setCheckpoints(d.checkpoints)
        setActiveTradeId(d.activeTradeId)
        setEntryPrice(d.entryPrice)
        setCurrentLtp(d.currentLtp)
        setStopLoss(d.stopLoss)
        setTarget(d.target)
      } catch (err) {
        // Ignore offline errors
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
    setExchange(INDEX_CONFIG[val].exchange)
    setQuantity(INDEX_CONFIG[val].qty)
  }

  const startStrategy = async () => {
    try {
      setMessage('Starting breakout engine on backend...')
      const payload = {
        underlying,
        exchange,
        quantity,
        lookback,
        targetPoints,
        bufferPoints,
        maxRangeLimit,
        strikeMode,
        strikeDepth,
        premiumMin,
        premiumMax,
        liveTradingConsent
      }
      await apiPost('/strategies/5minBreakout/start', payload)
      setIsRunning(true)
      setState('WAITING')
    } catch (err) {
      console.error('Failed to start strategy:', err)
      setMessage('Failed to launch strategy on backend engine.')
    }
  }

  const stopStrategy = async () => {
    try {
      setMessage('Halting strategy on backend...')
      await apiPost('/strategies/5minBreakout/stop')
      setIsRunning(false)
      setState('STOPPED')
      setActiveTradeId(null)
      setEntryPrice(null)
      setCurrentLtp(null)
      setStopLoss(null)
      setTarget(null)
    } catch (err) {
      console.error('Failed to stop strategy:', err)
    }
  }

  const manualExitPosition = async () => {
    if (isExiting) return
    setIsExiting(true)
    setMessage('Manual exit initiated...')
    try {
      await apiPost('/strategies/5minBreakout/exit')
    } catch (err) {
      console.error('Failed to exit position:', err)
    } finally {
      setIsExiting(false)
    }
  }

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
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Stop Loss</p>
                  <p className="text-xl font-black text-rose-500 dark:text-rose-400 mt-1">₹{stopLoss?.toFixed(2) || '---'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Target</p>
                  <p className="text-xl font-black text-emerald-500 dark:text-emerald-400 mt-1">₹{target?.toFixed(2) || '---'}</p>
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
              </div>
            </div>
          )}
        </div>

        {/* Checkpoints & Monitor Side Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 rounded-[2rem] border border-white/5 shadow-2xl p-8 relative overflow-hidden group">
            <div className="space-y-4">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Monitored Premiums</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 p-4 rounded-xl">
                  <p className="text-[10px] text-cyan-400 font-bold uppercase">CE Premium</p>
                  <p className="text-sm font-black text-white mt-1">{monitoredPremiums.ce}</p>
                </div>
                <div className="bg-white/5 p-4 rounded-xl">
                  <p className="text-[10px] text-rose-400 font-bold uppercase">PE Premium</p>
                  <p className="text-sm font-black text-white mt-1">{monitoredPremiums.pe}</p>
                </div>
              </div>

              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest pt-4">Checkpoints</p>
              <div className="space-y-2">
                {checkpoints.map(cp => (
                  <div key={cp.id} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 p-3 rounded-xl">
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
