import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Square, XCircle, Target, Shield, Clock } from 'lucide-react'
import { apiGet, apiPost } from '../../trading'
import { usePageTitle } from '../../hooks/usePageTitle'
import StrategiesLayout from './StrategiesLayout'

type ParameterSchema = {
  type: string
  default: any
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

export default function DynamicStrategyPage() {
  const { strategyId } = useParams<{ strategyId: string }>()
  const navigate = useNavigate()
  const [manifest, setManifest] = useState<StrategyManifest | null>(null)
  const [engineSchema, setEngineSchema] = useState<Record<string, ParameterSchema>>({})
  const [config, setConfig] = useState<Record<string, any>>({})
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  usePageTitle(manifest ? manifest.name : 'Strategy Execution')

  useEffect(() => {
    async function loadManifestAndSchema() {
      try {
        const res = await apiGet<any>('/strategies/manifests')
        const manifestList = res?.data?.manifests || res?.manifests || []
        const schema = res?.data?.engineSchema || res?.engineSchema || {}
        setEngineSchema(schema)

        const found = manifestList.find((m: StrategyManifest) => m.id === strategyId)
        if (found) {
          setManifest(found)

          // Load Saved State if available, else load schema & manifest defaults
          const savedStr = localStorage.getItem(`strat_cfg_${strategyId}`)
          if (savedStr) {
            try {
              setConfig(JSON.parse(savedStr))
            } catch (e) {
              initializeDefaults(schema, found)
            }
          } else {
            initializeDefaults(schema, found)
          }
        }
      } catch (err) {
        console.error('Failed to load strategy manifest & schema:', err)
      } finally {
        setLoading(false)
      }
    }

    function initializeDefaults(schema: Record<string, ParameterSchema>, foundManifest: StrategyManifest) {
      const initialConfig: Record<string, any> = {}
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
    if (strategyId && Object.keys(config).length > 0) {
      localStorage.setItem(`strat_cfg_${strategyId}`, JSON.stringify(config))
    }
  }, [config, strategyId])

  useEffect(() => {
    if (!strategyId) return
    const fetchStatus = async () => {
      try {
        const res = await apiGet<any>(`/strategies/${strategyId}/status`)
        const data = res?.data || res
        setStatus(data)
      } catch (e) {}
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [strategyId])

  const handleStart = async () => {
    if (!strategyId) return
    try {
      const res = await apiPost<any>(`/strategies/${strategyId}/start`, config)
      const data = res?.data || res
      setStatus(data)
    } catch (e: any) {
      alert(`Start failed: ${e.message}`)
    }
  }

  const handleStop = async () => {
    if (!strategyId) return
    try {
      const res = await apiPost<any>(`/strategies/${strategyId}/stop`)
      const data = res?.data || res
      setStatus(data)
    } catch (e: any) {
      alert(`Stop failed: ${e.message}`)
    }
  }

  const handleExit = async () => {
    if (!strategyId) return
    try {
      const res = await apiPost<any>(`/strategies/${strategyId}/exit`)
      const data = res?.data || res
      setStatus(data)
    } catch (e: any) {
      alert(`Exit failed: ${e.message}`)
    }
  }

  const evaluateVisibility = (condition: string | undefined) => {
    if (!condition) return true
    const match = condition.match(/([a-zA-Z0-9_]+)\s*(!=|==)\s*['"]?([a-zA-Z0-9_]+)['"]?/)
    if (!match) return true
    const [_, field, operator, value] = match
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

  if (!manifest) {
    return (
      <StrategiesLayout title="Strategy Not Found" backTo="/strategies">
        <div className="p-8 text-center text-sm font-semibold text-red-500">
          Strategy plugin "{strategyId}" is not registered or supported by the current engine.
        </div>
      </StrategiesLayout>
    )
  }

  // Combine Core Engine fields + Plugin manifest parameters
  const combinedSchema: Record<string, ParameterSchema> = { ...engineSchema }
  Object.entries(manifest.parameters || {}).forEach(([key, param]) => {
    combinedSchema[key] = {
      ...param,
      grouping: param.grouping || 'Strategy Settings',
      order: param.order || 50
    }
  })

  // Group schema fields by their grouping tag
  const groups: Record<string, Array<{ key: string; param: ParameterSchema }>> = {}
  Object.entries(combinedSchema).forEach(([key, param]) => {
    const groupName = param.grouping || 'Other Settings'
    if (!groups[groupName]) {
      groups[groupName] = []
    }
    groups[groupName].push({ key, param })
  })

  // Sort groups internally by display order
  Object.keys(groups).forEach((gName) => {
    groups[gName].sort((a, b) => (a.param.order || 99) - (b.param.order || 99))
  })

  // Group headers ordering preference
  const groupOrder = ['Core Settings', 'Strike Selection', 'Exit Settings', 'Strategy Settings', 'Risk Settings']

  const sortedGroups = Object.keys(groups).sort((a, b) => {
    const idxA = groupOrder.indexOf(a)
    const idxB = groupOrder.indexOf(b)
    if (idxA !== -1 && idxB !== -1) return idxA - idxB
    if (idxA !== -1) return -1
    if (idxB !== -1) return 1
    return a.localeCompare(b)
  })

  // Position Monitor stats
  const ltp = status?.currentLtp || null
  const entryPrice = status?.entryPrice || null
  const quantity = config?.quantity || 1
  const trend = status?.trend || 'NEUTRAL'
  const isRunning = !!status?.isRunning
  const state = status?.state || 'STOPPED'

  return (
    <StrategiesLayout title={manifest.name} subtitle={manifest.description} backTo="/strategies">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Dashboard & Status */}
        <div className="lg:col-span-8 space-y-6">
          {/* Controls Panel */}
          <div className="bg-white rounded border border-[#E0E3EB] p-4 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold text-[#787B86] uppercase tracking-wider">Engine v{manifest.engineVersion}</span>
              <h2 className="text-sm font-bold text-[#1E222D] mt-0.5">{manifest.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              {!isRunning ? (
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#0052FF] text-white hover:bg-[#0052FF]/90 text-xs font-bold rounded shadow-sm transition-colors"
                >
                  <Play className="w-3.5 h-3.5" /> Start Engine
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#F23645] text-white hover:bg-[#F23645]/90 text-xs font-bold rounded shadow-sm transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" /> Stop Engine
                  </button>
                  <button
                    type="button"
                    onClick={handleExit}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#F0F3FA] text-[#1E222D] hover:bg-[#E0E3EB] text-xs font-bold rounded transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Force Exit
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Real-time Position Monitor */}
          {state !== 'STOPPED' && (
            <div className="bg-white p-4 rounded border border-[#E0E3EB] shadow-sm">
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
                    {ltp && entryPrice ? `₹${((ltp - entryPrice) * quantity).toFixed(2)}` : '---'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#787B86] uppercase">Signal Trend</p>
                  <p className={`text-sm font-bold mt-0.5 ${trend === 'BULLISH' ? 'text-[#089981]' : trend === 'BEARISH' ? 'text-[#F23645]' : 'text-[#787B86]'}`}>
                    {trend}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Execution Logs */}
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

        {/* Right Column: Schema Configuration Forms */}
        <div className="lg:col-span-4 space-y-4">
          {sortedGroups.map((gName) => (
            <div key={gName} className="bg-white rounded border border-[#E0E3EB] shadow-sm p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E222D] mb-4 flex items-center gap-1.5 pb-2 border-b border-[#E0E3EB]">
                {gName === 'Core Settings' ? <Shield className="w-3.5 h-3.5 text-[#0052FF]" /> :
                 gName === 'Exit Settings' ? <Clock className="w-3.5 h-3.5 text-[#0052FF]" /> :
                 <Target className="w-3.5 h-3.5 text-[#0052FF]" />}
                {gName}
              </h3>

              <div className="space-y-4">
                {groups[gName].map(({ key, param }) => {
                  if (!evaluateVisibility(param.visibilityCondition)) return null

                  if (param.type === 'boolean') {
                    return (
                      <div key={key} className="flex items-center justify-between p-2.5 bg-[#F8F9FA] rounded border border-[#E0E3EB]">
                        <span className="text-xs font-semibold text-[#434651]">{param.label}</span>
                        <input
                          type="checkbox"
                          checked={!!(config[key] ?? param.default)}
                          disabled={isRunning}
                          onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
                          className="w-4 h-4 text-[#0052FF] rounded border-[#E0E3EB] focus:ring-0 focus:outline-none"
                        />
                      </div>
                    )
                  }

                  if (param.type === 'select' && param.options) {
                    const currentVal = config[key] ?? param.default
                    return (
                      <div key={key} className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase text-[#787B86]">{param.label}</label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {param.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              disabled={isRunning}
                              onClick={() => setConfig({ ...config, [key]: opt })}
                              className={`py-1.5 rounded text-xs font-bold uppercase transition-colors ${currentVal === opt
                                ? 'bg-[#0052FF] text-white shadow-sm'
                                : 'bg-[#F0F3FA] text-[#434651] hover:bg-[#E0E3EB]'
                                }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[#787B86]">{param.label}</label>
                      <input
                        type={param.type === 'number' ? 'number' : 'text'}
                        value={config[key] ?? param.default}
                        disabled={isRunning}
                        onChange={(e) => setConfig({ ...config, [key]: param.type === 'number' ? Number(e.target.value) : e.target.value })}
                        className="w-full px-3 py-1.5 text-xs font-medium border border-[#E0E3EB] rounded focus:outline-none focus:border-[#0052FF] disabled:bg-[#F8F9FA] disabled:text-[#787B86]"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </StrategiesLayout>
  )
}
