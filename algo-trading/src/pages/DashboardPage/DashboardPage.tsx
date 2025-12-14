import { useEffect, useMemo, useState } from 'react'

type AngelLoginResponse = {
  status: boolean
  message?: string
  client_code?: string
}

type OrdersResponse = {
  items: Array<{
    id: string
    created_at: string
    request: Record<string, unknown>
    response: Record<string, unknown>
  }>
}

type PlaceOrderResponse = {
  item: {
    id: string
    created_at: string
    request: Record<string, unknown>
    response: Record<string, unknown>
  }
}
type AngelProfileResponse = Record<string, unknown>

type Exchange = 'NFO' | 'BFO'
type Underlying = 'NIFTY' | 'BANKNIFTY' | 'SENSEX'
type OptionType = 'CE' | 'PE'
type Side = 'BUY' | 'SELL'
type Product = 'DELIVERY' | 'INTRADAY'

type TradeTab = 'OPTIONS' | 'EQUITY'

type IndexOptionContract = {
  exchange: Exchange
  underlying: Underlying
  expiry: string
  strike: number
  lot_size: number
  option_type: OptionType
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

type EquitySearchItem = {
  tradingsymbol: string
  symboltoken: string
  name?: string
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

function formatLocalTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

type ConfirmState = {
  open: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const [isWorking, setIsWorking] = useState(false)

  if (!state.open) return null

  async function handleConfirm() {
    setIsWorking(true)
    try {
      await state.onConfirm()
      onClose()
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={state.title}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-900">
        <h3 className="text-base font-semibold">{state.title}</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{state.message}</p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isWorking}
            className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-70 dark:border-white/10 dark:hover:bg-white/10"
          >
            {state.cancelText}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isWorking}
            className={[
              'rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-70',
              state.destructive
                ? 'bg-rose-400 text-slate-950 hover:bg-rose-300'
                : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {isWorking ? 'Please wait…' : state.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

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

export default function DashboardPage() {
  const [connectStatus, setConnectStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [connectMessage, setConnectMessage] = useState<string>('')

  const [profile, setProfile] = useState<AngelProfileResponse | null>(null)

  const [tab, setTab] = useState<TradeTab>('OPTIONS')

  const [exchange, setExchange] = useState<Exchange>('NFO')
  const [underlying, setUnderlying] = useState<Underlying>('NIFTY')
  const [expiry, setExpiry] = useState<string>('')
  const [strike, setStrike] = useState<number | null>(null)
  const [optionType, setOptionType] = useState<OptionType>('CE')
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [expiries, setExpiries] = useState<string[]>([])
  const [strikes, setStrikes] = useState<number[]>([])
  const [contracts, setContracts] = useState<IndexOptionContract[]>([])
  const [strikeInput, setStrikeInput] = useState<string>('')
  const [indexLtp, setIndexLtp] = useState<number | null>(null)
  const [ltpError, setLtpError] = useState<string | null>(null)

  const [equityQuery, setEquityQuery] = useState<string>('')
  const [equityError, setEquityError] = useState<string | null>(null)
  const [equityItems, setEquityItems] = useState<EquitySearchItem[]>([])
  const [selectedEquity, setSelectedEquity] = useState<EquitySearchItem | null>(null)

  const selected = useMemo<IndexOptionContract | null>(() => {
    if (!expiry || strike === null) return null
    const eps = 1e-6
    const found = contracts.find(
      (c) => c.expiry === expiry && Math.abs(c.strike - strike) < eps && c.option_type === optionType,
    )
    return found ?? null
  }, [contracts, expiry, optionType, strike])

  const selectedLotSize = useMemo<number | null>(() => {
    if (tab !== 'OPTIONS') return null
    if (!selected) return null
    return Number.isFinite(selected.lot_size) && selected.lot_size > 0 ? selected.lot_size : null
  }, [selected, tab])

  const [side, setSide] = useState<Side>('BUY')
  const [product, setProduct] = useState<Product>('INTRADAY')
  const [quantity, setQuantity] = useState<number>(50)
  const [placeOrderError, setPlaceOrderError] = useState<string | null>(null)

  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => undefined,
  })

  const [orders, setOrders] = useState<OrdersResponse['items']>([])

  const allowedUnderlyings = useMemo<Underlying[]>(() => {
    return exchange === 'BFO' ? ['SENSEX'] : ['NIFTY', 'BANKNIFTY']
  }, [exchange])

  const strikeStep = useMemo<number>(() => {
    if (strikes.length < 2) return 1
    const sorted = [...strikes].sort((a, b) => a - b)
    let best = Number.POSITIVE_INFINITY
    for (let i = 1; i < sorted.length; i++) {
      const d = sorted[i] - sorted[i - 1]
      if (d > 0 && d < best) best = d
    }
    return Number.isFinite(best) ? best : 1
  }, [strikes])

  const filteredStrikes = useMemo<number[]>(() => {
    const sorted = [...strikes].sort((a, b) => a - b)

    let out = sorted
    if (indexLtp !== null && Number.isFinite(indexLtp) && strikeStep > 0) {
      const range = strikeStep * 20
      out = out.filter((s) => Math.abs(s - indexLtp) <= range)
    }

    const q = strikeInput.trim()
    if (q.length > 0) {
      out = out.filter((s) => String(s).includes(q))
    }

    return out
  }, [indexLtp, strikeInput, strikeStep, strikes])

  function formatStrike(v: number): string {
    if (!Number.isFinite(v)) return String(v)
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
    return String(v)
  }

  async function loadExpiries(nextExchange: Exchange, nextUnderlying: Underlying) {
    setOptionsError(null)
    setExpiry('')
    setStrike(null)
    setStrikeInput('')
    setExpiries([])
    setStrikes([])
    setContracts([])

    try {
      const data = await apiGet<IndexOptionsResponse>(
        `/instruments/index-options?exchange=${encodeURIComponent(nextExchange)}&underlying=${encodeURIComponent(nextUnderlying)}`,
      )

      setExpiries(data.expiries)
      const firstExpiry = data.expiries[0] ?? ''
      setExpiry(firstExpiry)
    } catch (e) {
      setOptionsError(e instanceof Error ? e.message : 'Failed to load options list')
    }
  }

  async function loadStrikes(nextExchange: Exchange, nextUnderlying: Underlying, nextExpiry: string) {
    setOptionsError(null)
    setStrike(null)
    setStrikeInput('')
    setStrikes([])
    setContracts([])

    if (!nextExpiry) return

    try {
      const data = await apiGet<IndexOptionsResponse>(
        `/instruments/index-options?exchange=${encodeURIComponent(nextExchange)}&underlying=${encodeURIComponent(
          nextUnderlying,
        )}&expiry=${encodeURIComponent(nextExpiry)}`,
      )

      setStrikes(data.strikes)
      setContracts(data.contracts)
      const firstStrike = data.strikes[0]
      const nextStrike = typeof firstStrike === 'number' ? firstStrike : null
      setStrike(nextStrike)
      setStrikeInput(nextStrike === null ? '' : formatStrike(nextStrike))
    } catch (e) {
      setOptionsError(e instanceof Error ? e.message : 'Failed to load strikes')
    }
  }

  async function loadIndexLtp(nextUnderlying: Underlying) {
    setLtpError(null)
    setIndexLtp(null)

    try {
      const data = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(nextUnderlying)}`)
      setIndexLtp(data.ltp)
    } catch (e) {
      setLtpError(e instanceof Error ? e.message : 'Failed to load index price')
    }
  }

  async function searchEquity() {
    setEquityError(null)
    setEquityItems([])

    const q = equityQuery.trim()
    if (q.length < 1) return

    try {
      const data = await apiGet<Record<string, unknown>>(
        `/angel/search?exchange=${encodeURIComponent('NSE')}&query=${encodeURIComponent(q)}`,
      )

      const raw: unknown = (data as { data?: unknown }).data ?? data
      if (!Array.isArray(raw)) {
        setEquityItems([])
        return
      }

      const items: EquitySearchItem[] = []
      for (const x of raw) {
        if (!x || typeof x !== 'object') continue
        const obj = x as Record<string, unknown>

        const ts = (obj.tradingsymbol ?? obj.tradingSymbol ?? obj.symbolname ?? obj.symbol) as unknown
        const token = (obj.symboltoken ?? obj.token ?? obj.symbolToken) as unknown
        const name = (obj.name ?? obj.companyname ?? obj.symbolname) as unknown

        if (typeof ts !== 'string' || typeof token !== 'string') continue

        items.push({ tradingsymbol: ts, symboltoken: token, name: typeof name === 'string' ? name : undefined })
      }

      setEquityItems(items.slice(0, 50))
    } catch (e) {
      setEquityError(e instanceof Error ? e.message : 'Search failed')
    }
  }

  async function refreshOrders() {
    const data = await apiGet<OrdersResponse>('/angel/orders')
    setOrders(data.items)
  }

  async function clearOrders() {
    await fetch(`${API_BASE}/angel/orders`, { method: 'DELETE' })
    await refreshOrders()
  }

  async function onConnect() {
    setConfirm({
      open: true,
      title: 'Connect to Angel One',
      message: 'Do you want to connect to Angel One now?',
      confirmText: 'Connect',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setConnectStatus('connecting')
        setConnectMessage('')
        setProfile(null)

        try {
          const login = await apiPost<AngelLoginResponse>('/angel/login')
          setConnectStatus('connected')
          setConnectMessage(login.message ?? 'Angel One connected')
          const prof = await apiGet<AngelProfileResponse>('/angel/profile')
          setProfile(prof)
          await refreshOrders()
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Connect failed'
          setConnectStatus('error')
          setConnectMessage(msg)
        }
      },
    })
  }

  async function onDisconnect() {
    setConfirm({
      open: true,
      title: 'Disconnect',
      message: 'Do you want to disconnect from Angel One?',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
      onConfirm: async () => {
        try {
          await apiPost<Record<string, unknown>>('/angel/logout')
        } catch {
          // ignore
        }
        setConnectStatus('idle')
        setConnectMessage('Disconnected')
        setProfile(null)
      },
    })
  }

  async function onPlaceOrder() {
    setPlaceOrderError(null)

    if (tab === 'EQUITY') {
      if (!selectedEquity) {
        setPlaceOrderError('Please search and select a stock first.')
        return
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setPlaceOrderError('Quantity must be greater than 0.')
        return
      }

      setConfirm({
        open: true,
        title: 'Confirm order',
        message: `${side} ${quantity} ${selectedEquity.tradingsymbol}\nExchange: NSE\nProduct: ${
          product === 'DELIVERY' ? 'Regular' : 'Intraday'
        }`,
        confirmText: 'Place order',
        cancelText: 'Cancel',
        onConfirm: async () => {
          try {
            await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
              exchange: 'NSE',
              tradingsymbol: selectedEquity.tradingsymbol,
              symboltoken: selectedEquity.symboltoken,
              transactiontype: side,
              producttype: product,
              quantity,
            })
            await refreshOrders()
          } catch (e) {
            setPlaceOrderError(e instanceof Error ? e.message : 'Place order failed')
            await refreshOrders()
          }
        },
      })

      return
    }

    if (!selected) {
      setPlaceOrderError('Please select an option contract first.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPlaceOrderError('Quantity must be greater than 0.')
      return
    }

    if (selectedLotSize !== null && quantity % selectedLotSize !== 0) {
      setPlaceOrderError(`Options quantity must be a multiple of lot size (${selectedLotSize}).`)
      return
    }

    setConfirm({
      open: true,
      title: 'Confirm order',
      message: `${side} ${quantity} ${selected.tradingsymbol}\nExchange: ${selected.exchange}\nProduct: ${
        product === 'DELIVERY' ? 'Regular' : 'Intraday'
      }`,
      confirmText: 'Place order',
      cancelText: 'Cancel',
      onConfirm: async () => {
        try {
          await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
            exchange: selected.exchange,
            tradingsymbol: selected.tradingsymbol,
            symboltoken: selected.symboltoken,
            transactiontype: side,
            producttype: product,
            quantity,
          })
          await refreshOrders()
        } catch (e) {
          setPlaceOrderError(e instanceof Error ? e.message : 'Place order failed')
          await refreshOrders()
        }
      },
    })
  }

  useEffect(() => {
    void refreshOrders().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (exchange === 'BFO' && underlying !== 'SENSEX') {
      setUnderlying('SENSEX')
      return
    }
    if (exchange === 'NFO' && underlying === 'SENSEX') {
      setUnderlying('NIFTY')
    }
  }, [exchange, underlying])

  useEffect(() => {
    // Ensure strike input always reflects current strike.
    setStrikeInput(strike === null ? '' : formatStrike(strike))
  }, [strike])

  useEffect(() => {
    void loadExpiries(exchange, underlying)
  }, [exchange, underlying])

  useEffect(() => {
    void loadStrikes(exchange, underlying, expiry)
  }, [exchange, expiry, underlying])

  useEffect(() => {
    if (tab !== 'OPTIONS') return
    void loadIndexLtp(underlying)
  }, [tab, underlying])

  useEffect(() => {
    if (tab !== 'OPTIONS') return
    const lot = selectedLotSize
    if (lot === null) return
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity % lot !== 0) {
      setQuantity(lot)
    }
  }, [quantity, selectedLotSize, tab])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Angel One Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Connect, place equity orders, and trade index options.
            </p>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Connection</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Status: <span className="font-medium">{connectStatus}</span>
              </p>
              {connectMessage ? <p className="mt-2 text-sm">{connectMessage}</p> : null}
            </div>
            {connectStatus === 'connected' ? (
              <button
                type="button"
                onClick={() => void onDisconnect()}
                className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void onConnect()}
                disabled={connectStatus === 'connecting'}
                className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-70"
              >
                {connectStatus === 'connecting' ? 'Connecting…' : 'Connect to Angel One'}
              </button>
            )}
          </div>

          {profile ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Connected.</p>
          ) : null}
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Trading</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Choose Equity (NSE) or Index Options (NFO/BFO).</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('OPTIONS')}
                className={[
                  'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                  tab === 'OPTIONS'
                    ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                    : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                Options
              </button>
              <button
                type="button"
                onClick={() => setTab('EQUITY')}
                className={[
                  'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                  tab === 'EQUITY'
                    ? 'bg-violet-400 text-slate-950 hover:bg-violet-300'
                    : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                Equity
              </button>
            </div>
          </div>

          {tab === 'OPTIONS' ? (
            <div className="mt-5">
              <h3 className="text-base font-semibold">Index Options</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                NFO: NIFTY, BANKNIFTY. BFO: SENSEX.
              </p>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold" htmlFor="exchange">
                    Exchange
                  </label>
                  <select
                    id="exchange"
                    value={exchange}
                    onChange={(e) => setExchange(e.target.value as Exchange)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20"
                  >
                    <option value="NFO">NFO</option>
                    <option value="BFO">BFO</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold" htmlFor="underlying">
                    Underlying
                  </label>
                  <select
                    id="underlying"
                    value={underlying}
                    onChange={(e) => setUnderlying(e.target.value as Underlying)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20"
                  >
                    {allowedUnderlyings.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold" htmlFor="expiry">
                    Expiry
                  </label>
                  <select
                    id="expiry"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20"
                  >
                    {expiries.length === 0 ? <option value="">No expiries</option> : null}
                    {expiries.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold" htmlFor="strike">
                    Strike
                  </label>
                  <input
                    id="strike"
                    list="strike-list"
                    value={strikeInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setStrikeInput(v)
                      const parsed = Number(v)
                      if (!Number.isFinite(parsed)) {
                        setStrike(null)
                        return
                      }

                      const eps = 1e-6
                      const found = strikes.find((s) => Math.abs(s - parsed) < eps)
                      setStrike(found ?? null)
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20"
                  />

                  <datalist id="strike-list">
                    {filteredStrikes.map((s) => (
                      <option key={s} value={formatStrike(s)} />
                    ))}
                  </datalist>

                  {indexLtp !== null ? (
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">ATM filter using index price: {indexLtp}</p>
                  ) : null}
                  {ltpError ? <p className="mt-2 text-xs text-rose-600">{ltpError}</p> : null}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-sm font-semibold">Option type</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOptionType('CE')}
                    className={[
                      'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                      optionType === 'CE'
                        ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                        : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    CALL (CE)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptionType('PE')}
                    className={[
                      'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                      optionType === 'PE'
                        ? 'bg-violet-400 text-slate-950 hover:bg-violet-300'
                        : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    PUT (PE)
                  </button>
                </div>
              </div>

              {optionsError ? <p className="mt-3 text-sm text-rose-600">{optionsError}</p> : null}
            </div>
          ) : (
            <div className="mt-5">
              <h3 className="text-base font-semibold">Equity (NSE)</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Search and select a stock, then place an order.</p>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  value={equityQuery}
                  onChange={(e) => setEquityQuery(e.target.value)}
                  placeholder="Type a stock name or symbol"
                  className="w-full flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20"
                />
                <button
                  type="button"
                  onClick={() => void searchEquity()}
                  disabled={equityQuery.trim().length < 1}
                  className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Search
                </button>
              </div>

              {equityError ? <p className="mt-3 text-sm text-rose-600">{equityError}</p> : null}

              {equityItems.length > 0 ? (
                <div className="mt-4">
                  <p className="text-sm text-slate-600 dark:text-slate-300">Select a stock:</p>
                  <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
                    {equityItems.map((it) => {
                      const active = selectedEquity?.symboltoken === it.symboltoken
                      return (
                        <button
                          key={it.symboltoken}
                          type="button"
                          onClick={() => {
                            setSelectedEquity(it)
                            setEquityQuery('')
                            setEquityItems([])
                          }}
                          className={[
                            'flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm',
                            'border-b border-slate-200 last:border-b-0 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                            active ? 'bg-cyan-100 dark:bg-cyan-400/10' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span>
                            <span className="font-semibold">{it.tradingsymbol}</span>
                            {it.name ? <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">{it.name}</span> : null}
                          </span>
                          <span className="text-xs text-slate-600 dark:text-slate-300">NSE</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">Place order</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Choose a symbol, quantity, side, and product. Market-closed rejections will still be saved and shown below.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-slate-600 dark:text-slate-300">Selected symbol</p>
              <p className="mt-1 text-sm font-semibold">
                {tab === 'OPTIONS'
                  ? selected
                    ? selected.tradingsymbol
                    : 'None'
                  : selectedEquity
                    ? selectedEquity.tradingsymbol
                    : 'None'}
              </p>
              {tab === 'OPTIONS' && selected ? (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {selected.exchange} · {selected.underlying} · {selected.expiry} · {selected.strike} {selected.option_type}
                </p>
              ) : null}
              {tab === 'EQUITY' && selectedEquity ? (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">NSE · Equity</p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold" htmlFor="qty">
                Quantity
              </label>
              <input
                id="qty"
                type="number"
                min={tab === 'OPTIONS' && selectedLotSize !== null ? selectedLotSize : 1}
                step={tab === 'OPTIONS' && selectedLotSize !== null ? selectedLotSize : 1}
                value={Number.isFinite(quantity) ? quantity : ''}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20"
              />
              {tab === 'OPTIONS' && selectedLotSize !== null ? (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Lot size: {selectedLotSize}</p>
              ) : null}
            </div>

            <div>
              <p className="text-sm font-semibold">Side</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSide('BUY')}
                  className={[
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    side === 'BUY'
                      ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                      : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setSide('SELL')}
                  className={[
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    side === 'SELL'
                      ? 'bg-rose-400 text-slate-950 hover:bg-rose-300'
                      : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  SELL
                </button>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold">Product</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setProduct('DELIVERY')}
                  className={[
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    product === 'DELIVERY'
                      ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                      : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  Regular
                </button>
                <button
                  type="button"
                  onClick={() => setProduct('INTRADAY')}
                  className={[
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    product === 'INTRADAY'
                      ? 'bg-violet-400 text-slate-950 hover:bg-violet-300'
                      : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  Intraday
                </button>
              </div>
            </div>
          </div>

          {placeOrderError ? <p className="mt-3 text-sm text-rose-600">{placeOrderError}</p> : null}

          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => void onPlaceOrder()}
              className="rounded-xl bg-violet-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-violet-300"
            >
              Place order
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Order attempts</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshOrders()}
                className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirm({
                    open: true,
                    title: 'Clear order history',
                    message: 'This will permanently delete all stored order history.\n\nThis action cannot be undone.',
                    confirmText: 'Clear',
                    cancelText: 'Cancel',
                    destructive: true,
                    onConfirm: async () => {
                      await clearOrders()
                    },
                  })
                }}
                className="rounded-xl border border-rose-300 bg-transparent px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10"
              >
                Clear history
              </button>
            </div>
          </div>

          {orders.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No orders yet.</p>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Symbol</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Side</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    (() => {
                      const req = o.request
                      const resp = o.response
                      const symbol = asString(req.tradingsymbol)
                      const qty = asString(req.quantity)
                      const sideText = asString(req.transactiontype)
                      const productType = asString(req.producttype)
                      const typeText = productType === 'INTRADAY' ? 'Intraday' : productType === 'DELIVERY' ? 'Regular' : productType
                      const ok = isSuccessResponse(resp)

                      return (
                    <tr key={o.id} className="border-t border-slate-200 dark:border-white/10">
                      <td className="py-2 pr-3 align-top font-mono text-xs">{formatLocalTime(o.created_at)}</td>
                      <td className="py-2 pr-3 align-top font-mono text-xs">{symbol || '-'}</td>
                      <td className="py-2 pr-3 align-top font-mono text-xs">{qty || '-'}</td>
                      <td className="py-2 pr-3 align-top font-mono text-xs">{sideText || '-'}</td>
                      <td className="py-2 pr-3 align-top">{typeText || '-'}</td>
                      <td className="py-2 pr-3 align-top">
                        <span
                          className={[
                            'inline-flex rounded-lg px-2 py-1 text-xs font-semibold',
                            ok
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {ok ? 'Success' : 'Failed'}
                        </span>
                      </td>
                    </tr>
                      )
                    })()
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ConfirmDialog
          state={confirm}
          onClose={() =>
            setConfirm((c) => ({
              ...c,
              open: false,
            }))
          }
        />
      </div>
    </div>
  )
}
