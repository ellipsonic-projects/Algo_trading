import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Square, XCircle, Target, Activity, ShieldAlert, ChevronRight } from 'lucide-react'
import { apiGet, apiPost } from '../../trading'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import StrategiesLayout from './StrategiesLayout'

// ─── Domain Types ──────────────────────────────────────────────────────────────

type ParameterSchema = {
  type: string
  default: string | number | boolean
  label: string
  min?: number
  max?: number
  options?: string[]
  grouping?: string
  order?: number
  visibilityCondition?: string
}

type StrategyManifest = {
  id: string
  name: string
  version: string
  engineVersion: string
  description: string
  requires: {
    timeframe: string
    lookbackCandles: number
    dataStreams: string[]
  }
  parameters: Record<string, ParameterSchema>
}

type OptionContract = {
  exchange: string
  tradingsymbol: string
  symboltoken: string
}

type Checkpoint = {
  id: string
  label: string
  status: 'success' | 'pending' | 'error'
}

/** Shape returned verbatim by strategyEngine.getStatus() */
type StrategyStatus = {
  strategyName: string
  isRunning: boolean
  state: string
  message: string
  trend: string
  selectedExpiry: string | null
  atmStrike: number | null
  ceContract: OptionContract | null
  peContract: OptionContract | null
  monitoredPremiums: { ce: string; pe: string }
  checkpoints: Checkpoint[]
  activeTradeId: string | null
  activeTradePremium: string | null
  entryPrice: number | null
  currentLtp: number | null
  activeTrailingSl: number | null
  stopLoss: number | null
  target: number | null
  lastCompletedTrade: Record<string, unknown> | null
  exitInProgress: boolean
  exitTriggered: boolean
  exitReasonStored: string | null
  lastExitError: string | null
  exitRetryCount: number
  lastExitAttemptTime: number
  logs: string[]
}

type ManifestsApiResponse = {
  data?: { manifests: StrategyManifest[]; engineSchema: Record<string, ParameterSchema> }
  manifests?: StrategyManifest[]
  engineSchema?: Record<string, ParameterSchema>
}

type StatusApiResponse = {
  data?: StrategyStatus
} & Partial<StrategyStatus>

// ─── Pure helpers (module scope — no stale-closure risk) ──────────────────────

function computeSchemaSignature(
  schemaObj: Record<string, ParameterSchema>,
  manifestObj: StrategyManifest | null
): string {
  const schemaKeys = Object.keys(schemaObj).sort().join(',')
  const manifestKeys = Object.keys(manifestObj?.parameters || {}).sort().join(',')
  return `${schemaKeys}|${manifestKeys}`
}

/** Narrow a config value to number (for input[type=number] value prop and arithmetic) */
function cfgNum(val: string | number | boolean | undefined, fallback: number): number {
  return typeof val === 'number' ? val : fallback
}

/** Narrow a config value to string (for select/text input value prop) */
function cfgStr(val: string | number | boolean | undefined, fallback: string): string {
  return val !== undefined && val !== null ? String(val) : fallback
}

export default function DynamicStrategyPage() {
  const { strategyId } = useParams<{ strategyId: string }>()
  const { connectStatus } = useAngelConnection()
  const [manifest, setManifest] = useState<StrategyManifest | null>(null)
  const [engineSchema, setEngineSchema] = useState<Record<string, ParameterSchema>>({})
  const [config, setConfig] = useState<Record<string, string | number | boolean>>({})
  const [status, setStatus] = useState<StrategyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isExiting, setIsExiting] = useState(false)

  usePageTitle(manifest ? manifest.name : 'Strategy Execution')

  useEffect(() => {
    async function loadManifestAndSchema() {
      try {
        const res = await apiGet<ManifestsApiResponse>('/strategies/manifests')
        const manifestList = res?.data?.manifests || res?.manifests || []
        const schema = res?.data?.engineSchema || res?.engineSchema || {}
        setEngineSchema(schema)

        const found = manifestList.find((m: StrategyManifest) => m.id === strategyId)
        if (found) {
          setManifest(found)

          // Load Saved State if available, else load schema & manifest defaults
          const savedStr = localStorage.getItem(`strat_cfg_v2_${strategyId}`)
          const signature = computeSchemaSignature(schema, found)
          if (savedStr) {
            try {
              const parsed = JSON.parse(savedStr) as { signature: string; config: Record<string, string | number | boolean> }
              if (parsed && parsed.signature === signature) {
                setConfig(parsed.config)
              } else {
                initializeDefaults(schema, found)
              }
            } catch {
              initializeDefaults(schema, found)
            }
          } else {
            initializeDefaults(schema, found)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Failed to load strategy manifest & schema:', err)
        setLoadError(`Failed to load strategy configuration: ${msg}`)
      } finally {
        setLoading(false)
      }
    }

    function initializeDefaults(schema: Record<string, ParameterSchema>, foundManifest: StrategyManifest) {
      const initialConfig: Record<string, string | number | boolean> = {}
      // 1. Engine Schema Defaults
      Object.entries(schema).forEach(([key, param]) => {
        initialConfig[key] = param.default
      })
      // 2. Plugin Manifest Parameter Defaults
      Object.entries(foundManifest.parameters || {}).forEach(([key, param]) => {
        initialConfig[key] = param.default
      })
      setConfig(initialConfig)
    }

    loadManifestAndSchema()
  }, [strategyId])

  // Save config changes to local storage
  useEffect(() => {
    if (strategyId && Object.keys(config).length > 0 && Object.keys(engineSchema).length > 0 && manifest) {
      const signature = computeSchemaSignature(engineSchema, manifest)
      localStorage.setItem(`strat_cfg_v2_${strategyId}`, JSON.stringify({ config, signature }))
    }
  }, [config, strategyId, engineSchema, manifest])

  useEffect(() => {
    if (!strategyId) return
    const fetchStatus = async () => {
      try {
        const res = await apiGet<StatusApiResponse>(`/strategies/${strategyId}/status`)
        const data: StrategyStatus = (res?.data ?? res) as StrategyStatus
        setStatus(data)
      } catch {
        // status fetch errors are silently ignored; the interval will retry
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [strategyId])

  const handleStart = async () => {
    if (!strategyId) return
    try {
      const res = await apiPost<StatusApiResponse>(`/strategies/${strategyId}/start`, config)
      const data: StrategyStatus = (res?.data ?? res) as StrategyStatus
      setStatus(data)
    } catch (e: unknown) {
      alert(`Start failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleStop = async () => {
    if (!strategyId) return
    try {
      const res = await apiPost<StatusApiResponse>(`/strategies/${strategyId}/stop`)
      const data: StrategyStatus = (res?.data ?? res) as StrategyStatus
      setStatus(data)
    } catch (e: unknown) {
      alert(`Stop failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleExit = async () => {
    if (!strategyId) return
    setIsExiting(true)
    try {
      const res = await apiPost<StatusApiResponse>(`/strategies/${strategyId}/exit`)
      const data: StrategyStatus = (res?.data ?? res) as StrategyStatus
      setStatus(data)
    } catch (e: unknown) {
      alert(`Exit failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsExiting(false)
    }
  }

  const evaluateVisibility = (condition: string | undefined) => {
    if (!condition) return true
    const match = condition.match(/([a-zA-Z0-9_]+)\s*(!=|==)\s*['"]?([a-zA-Z0-9_]+)['"]?/)
    if (!match) return true
    const [, field, operator, value] = match
    const currentVal = config[field]
    if (operator === '!=') {
      return String(currentVal) !== value
    }
    if (operator === '==') {
      return String(currentVal) === value
    }
    return true
  }

  if (loading) {
    return (
      <StrategiesLayout title="Loading Strategy..." backTo="/strategies">
        <div className="p-8 text-center text-sm font-semibold text-[#787B86]">Loading strategy schema...</div>
      </StrategiesLayout>
    )
  }

  if (loadError) {
    return (
      <StrategiesLayout title="Configuration Error" backTo="/strategies">
        <div className="p-6 bg-white rounded border border-[#F23645] shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-[#F23645] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-[#1E222D] mb-1">Failed to Load Strategy</p>
              <p className="text-xs text-[#787B86] font-medium">{loadError}</p>
              <p className="text-xs text-[#787B86] mt-2">Check that the backend is running and the strategy plugin is registered.</p>
            </div>
          </div>
        </div>
      </StrategiesLayout>
    )
  }

  if (!manifest) {
    return (
      <StrategiesLayout title="Strategy Not Found" backTo="/strategies">
        <div className="p-8 text-center text-sm font-semibold text-red-500">
          Strategy plugin &ldquo;{strategyId}&rdquo; is not registered or supported by the current engine.
        </div>
      </StrategiesLayout>
    )
  }

  // Position Monitor stats
  const ltp = status?.currentLtp || null
  const entryPrice = status?.entryPrice || null

  const trend = status?.trend || 'NEUTRAL'
  const isRunning = !!status?.isRunning
  const state = status?.state || 'STOPPED'
  const message = status?.message || 'Ready to monitor market volatility and execution signals.'
  const activeTradePremium = status?.activeTradePremium || null
  const monitoredPremiums = status?.monitoredPremiums || { ce: '---', pe: '---' }
  const checkpoints = status?.checkpoints || [
    { id: 'broker', label: 'Broker Connection', status: connectStatus === 'connected' ? 'success' : 'pending' },
    { id: 'expiry', label: 'Next Expiry Locked', status: 'pending' },
    { id: 'trend', label: 'Strategy Trend', status: 'pending' },
    { id: 'timeframe', label: 'Timeframe Sync', status: 'pending' },
    { id: 'indicators', label: 'Premium Discovery', status: 'pending' }
  ]

  return (
    <StrategiesLayout title={manifest.name} subtitle={manifest.description} backTo="/strategies">
      <div className="space-y-4 select-none">
        
        {/* Status Panel Header */}
        <div className="bg-white rounded border border-[#E0E3EB] shadow-sm p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-[#089981] animate-pulse' : 'bg-[#787B86]'}`} />
                <h2 className="text-xs font-bold text-[#1E222D] uppercase tracking-wider">{manifest.name} Algo Controller</h2>
              </div>
              <p className="text-xs font-medium text-[#787B86]">{message}</p>
              <div className="flex items-center gap-6 pt-1">
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#787B86]">State</p>
                  <p className="text-xs font-bold text-[#1E222D]">{state}</p>
                </div>
                <div className="h-6 w-[1px] bg-[#E0E3EB]" />
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#787B86]">Signal Trend</p>
                  <p className={`text-xs font-bold ${trend === 'BULLISH' ? 'text-[#089981]' : trend === 'BEARISH' ? 'text-[#F23645]' : 'text-[#787B86]'}`}>
                    {trend}
                  </p>
                </div>
                {activeTradePremium && (
                  <>
                    <div className="h-6 w-[1px] bg-[#E0E3EB]" />
                    <div>
                      <p className="text-[10px] font-bold uppercase text-[#787B86]">Active Contract</p>
                      <p className="text-xs font-bold text-[#0052FF]">{activeTradePremium}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isRunning ? (
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#089981] hover:bg-[#07806c] text-white text-xs font-semibold rounded shadow-sm transition-colors"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Start Strategy
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#F23645] hover:bg-[#d92b39] text-white text-xs font-semibold rounded shadow-sm transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop Strategy
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Grid Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Left Column: Config, Position Monitor, and Logs */}
          <div className="lg:col-span-8 space-y-4">
            
            {/* Strategy Configuration Card */}
            <div className="bg-white rounded border border-[#E0E3EB] shadow-sm p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E222D] mb-4 flex items-center gap-1.5 pb-2 border-b border-[#E0E3EB]">
                <Activity className="w-3.5 h-3.5 text-[#0052FF]" />
                Strategy Configuration
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  {/* Underlying Selector */}
                  <div>
                    <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Underlying Instrument</label>
                    <select
                      value={cfgStr(config.underlying, 'SENSEX')}
                      disabled={isRunning}
                      onChange={(e) => setConfig({ ...config, underlying: e.target.value })}
                      className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF] disabled:opacity-50"
                    >
                      {engineSchema.underlying?.options?.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      )) || (
                        <>
                          <option value="SENSEX">SENSEX (BFO)</option>
                          <option value="BANKNIFTY">BANKNIFTY (NFO)</option>
                          <option value="NIFTY">NIFTY (NFO)</option>
                          <option value="FINNIFTY">FINNIFTY (NFO)</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Quantity input */}
                  <div>
                    <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Order Quantity</label>
                    <input
                      type="number"
                      value={cfgNum(config.quantity, 1)}
                      disabled={isRunning}
                      onChange={(e) => setConfig({ ...config, quantity: Number(e.target.value) })}
                      className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF] disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Primary Timeframe Display */}
                  <div>
                    <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Primary Timeframe</label>
                    <select
                      disabled={true}
                      value="5m"
                      className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#787B86] outline-none disabled:opacity-50"
                    >
                      <option value="5m">{manifest.requires?.timeframe || 'FIVE_MINUTE'}</option>
                    </select>
                  </div>

                  {/* Dynamic strategy-specific parameters from manifest */}
                  {Object.entries(manifest.parameters || {}).map(([key, param]) => (
                    <div key={key}>
                      <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">{param.label || key}</label>
                      <input
                        type={param.type === 'number' ? 'number' : 'text'}
                        value={cfgNum(config[key], typeof param.default === 'number' ? param.default : 0)}
                        disabled={isRunning}
                        onChange={(e) => setConfig({ ...config, [key]: param.type === 'number' ? Number(e.target.value) : e.target.value })}
                        className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF] disabled:opacity-50"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Real Market Execution Consent */}
              <div className="mt-4 flex items-center justify-between p-3 bg-[#F8F9FA] border border-[#E0E3EB] rounded">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#F23645]" />
                  <div>
                    <p className="text-xs font-bold text-[#1E222D]">Real Market Execution Consent</p>
                    <p className="text-[10px] text-[#787B86] font-medium">Transmit real orders to broker API</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!!(config.liveTradingConsent ?? false)}
                  disabled={isRunning}
                  onChange={(e) => setConfig({ ...config, liveTradingConsent: e.target.checked })}
                  className="w-4 h-4 text-[#F23645] rounded border-[#E0E3EB]"
                />
              </div>

              {/* Position Monitor Card */}
              {state !== 'STOPPED' && (
                <div className="mt-4 bg-white p-4 rounded border border-[#E0E3EB] shadow-sm">
                  <div className="flex items-center justify-between mb-3 border-b border-[#E0E3EB] pb-2">
                    <h3 className="text-xs font-bold uppercase text-[#0052FF]">Position Monitor</h3>
                    <span className="text-[10px] font-semibold text-[#089981]">Active Engine Feed</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="text-[10px] font-bold text-[#787B86] uppercase">LTP</p>
                      <p className="text-sm font-bold text-[#1E222D] tabular-nums mt-0.5">
                        {ltp ? `₹${ltp.toFixed(2)}` : '---'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-[#787B86] uppercase">Entry</p>
                      <p className="text-sm font-bold text-[#1E222D] tabular-nums mt-0.5">
                        {entryPrice ? `₹${entryPrice.toFixed(2)}` : '---'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-[#787B86] uppercase">Unrealized PNL</p>
                      <p className={`text-sm font-bold tabular-nums mt-0.5 ${ltp && entryPrice
                        ? ltp >= entryPrice ? 'text-[#089981]' : 'text-[#F23645]'
                        : 'text-[#787B86]'
                        }`}>
                        {ltp && entryPrice ? `₹${((ltp - entryPrice) * cfgNum(config.quantity, 1)).toFixed(2)}` : '---'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-[#787B86] uppercase">Signal Trend</p>
                      <p className={`text-sm font-bold mt-0.5 ${trend === 'BULLISH' ? 'text-[#089981]' : trend === 'BEARISH' ? 'text-[#F23645]' : 'text-[#787B86]'}`}>
                        {trend}
                      </p>
                    </div>
                  </div>

                  {state === 'IN_POSITION' && activeTradePremium && (
                    <div className="mt-4 pt-3 border-t border-[#E0E3EB] flex justify-end">
                      <button
                        onClick={handleExit}
                        disabled={isExiting}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-[#FF9800] hover:bg-[#e68a00] disabled:opacity-50 text-white text-xs font-semibold rounded shadow-sm transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {isExiting ? 'Exiting...' : 'Exit Position'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Live System Logs Console */}
            <div className="bg-white rounded border border-[#E0E3EB] p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-[#E0E3EB] pb-2">
                <h3 className="text-xs font-bold text-[#1E222D] uppercase tracking-wider">Live System Logs</h3>
                <span className="text-[10px] font-mono text-[#787B86]">Engine State: {state}</span>
              </div>
              <div className="p-3 bg-[#1E222D] text-white rounded text-[11px] font-mono h-64 overflow-y-auto space-y-1.5 custom-scrollbar">
                {status?.logs && status.logs.length > 0 ? (
                  status.logs.map((log: string, idx: number) => (
                    <div key={idx} className="opacity-90">{log}</div>
                  ))
                ) : (
                  <div className="text-[#787B86] italic text-center pt-24">Waiting for engine logs...</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Risk & Strike Parameters */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white rounded border border-[#E0E3EB] shadow-sm p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E222D] mb-4 flex items-center gap-1.5 pb-2 border-b border-[#E0E3EB]">
                <Target className="w-3.5 h-3.5 text-[#0052FF]" />
                Risk &amp; Strike Parameters
              </h3>

              <div className="space-y-4">
                {/* Strike Preference */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1.5 block">Strike Preference</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['ITM', 'ATM', 'OTM'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={isRunning}
                        onClick={() => setConfig({ ...config, strikeMode: mode })}
                        className={`py-1.5 rounded text-xs font-bold uppercase transition-colors ${
                          (config.strikeMode ?? 'ATM') === mode
                            ? 'bg-[#0052FF] text-white shadow-sm'
                            : 'bg-[#F0F3FA] text-[#434651] hover:bg-[#E0E3EB]'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Strike Offset Depth */}
                {evaluateVisibility('strikeMode != "ATM"') && (
                  <div>
                    <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Strike Offset Depth</label>
                    <div className="flex items-center justify-between p-1 bg-[#F0F3FA] border border-[#E0E3EB] rounded">
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, strikeDepth: Math.max(1, cfgNum(config.strikeDepth, 1) - 1) })}
                        disabled={isRunning}
                        className="w-7 h-7 flex items-center justify-center text-[#434651] font-bold text-base disabled:opacity-50"
                      >-</button>
                      <span className="text-xs font-bold text-[#1E222D]">{config.strikeDepth ?? 1}</span>
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, strikeDepth: cfgNum(config.strikeDepth, 1) + 1 })}
                        disabled={isRunning}
                        className="w-7 h-7 flex items-center justify-center text-[#434651] font-bold text-base disabled:opacity-50"
                      >+</button>
                    </div>
                  </div>
                )}

                {/* Option Premium Filter */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Option Premium Filter</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={cfgNum(config.premiumMin, 300)}
                      disabled={isRunning}
                      onChange={(e) => setConfig({ ...config, premiumMin: Number(e.target.value) })}
                      placeholder="Min"
                      className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF] disabled:opacity-50"
                    />
                    <ChevronRight className="w-3.5 h-3.5 text-[#787B86]" />
                    <input
                      type="number"
                      value={cfgNum(config.premiumMax, 400)}
                      disabled={isRunning}
                      onChange={(e) => setConfig({ ...config, premiumMax: Number(e.target.value) })}
                      placeholder="Max"
                      className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF] disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Exit Condition Logic */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1.5 block">Exit Condition Logic</label>
                  <div className="space-y-2">
                    {['POINTS', 'CANDLES', 'REVERSAL'].map((strategy) => (
                      <label key={strategy} className="flex items-center gap-2 cursor-pointer" onClick={() => !isRunning && setConfig({ ...config, exitStrategy: strategy })}>
                        <input
                          type="radio"
                          name="exitStrategy"
                          checked={(config.exitStrategy ?? 'POINTS') === strategy}
                          onChange={() => setConfig({ ...config, exitStrategy: strategy })}
                          disabled={isRunning}
                          className="w-3.5 h-3.5 text-[#0052FF]"
                        />
                        <span className="text-xs font-semibold text-[#1E222D]">{strategy}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Target & SL Inputs */}
                {(config.exitStrategy ?? 'POINTS') === 'POINTS' && (
                  <div className="space-y-3 pt-2 border-t border-[#E0E3EB]">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Target Points</label>
                      <input
                        type="number"
                        value={cfgNum(config.targetPoints, 20)}
                        onChange={(e) => setConfig({ ...config, targetPoints: Number(e.target.value) })}
                        disabled={isRunning}
                        className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#089981] disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-[#787B86] mb-1 block">Stop Loss Points</label>
                      <input
                        type="number"
                        value={cfgNum(config.slPoints, 30)}
                        onChange={(e) => setConfig({ ...config, slPoints: Number(e.target.value) })}
                        disabled={isRunning}
                        className="w-full bg-[#F0F3FA] border border-[#E0E3EB] rounded px-3 py-1.5 text-xs font-semibold text-[#1E222D] outline-none focus:border-[#F23645] disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Live Monitor Panel (Checkpoints & Monitored Options) */}
        <div className="bg-white rounded border border-[#E0E3EB] shadow-sm p-4">
          <h3 className="text-xs font-bold uppercase text-[#1E222D] mb-3 flex items-center gap-2 border-b border-[#E0E3EB] pb-2">
            <span className="w-2 h-2 rounded-full bg-[#0052FF] animate-pulse" />
            Engine Health Checkpoints &amp; Monitored Options
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className={`border rounded p-3 ${activeTradePremium === monitoredPremiums.ce && monitoredPremiums.ce !== '---'
              ? 'bg-[#0052FF]/10 border-[#0052FF]'
              : 'bg-[#F8F9FA] border-[#E0E3EB]'
              }`}>
              <p className="text-[10px] font-bold text-[#0052FF] uppercase mb-1">Monitored CE Option</p>
              <p className="text-sm font-bold text-[#1E222D]">{monitoredPremiums.ce}</p>
            </div>
            <div className={`border rounded p-3 ${activeTradePremium === monitoredPremiums.pe && monitoredPremiums.pe !== '---'
              ? 'bg-[#F23645]/10 border-[#F23645]'
              : 'bg-[#F8F9FA] border-[#E0E3EB]'
              }`}>
              <p className="text-[10px] font-bold text-[#F23645] uppercase mb-1">Monitored PE Option</p>
              <p className="text-sm font-bold text-[#1E222D]">{monitoredPremiums?.pe ?? '---'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {checkpoints?.map((cp: Checkpoint) => (
              <div key={cp.id} className="flex items-center gap-2 bg-[#F8F9FA] border border-[#E0E3EB] px-3 py-2 rounded">
                <div className={`w-2 h-2 rounded-full ${cp.status === 'success' ? 'bg-[#089981]' : cp.status === 'error' ? 'bg-[#F23645]' : 'bg-[#787B86]'}`} />
                <span className="text-[10px] font-semibold text-[#434651] uppercase truncate">{cp.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </StrategiesLayout>
  )
}
