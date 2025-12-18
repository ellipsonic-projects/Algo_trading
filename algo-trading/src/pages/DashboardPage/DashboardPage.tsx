import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { coerceProductForSide, getPositionExitProductType } from '../../trading/rules'
import { formatINR, pickFirstNumber } from '../../trading/money'
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'

type ToastKind = 'success' | 'error' | 'info'

type ToastItem = {
  id: string
  kind: ToastKind
  title: string
  message?: string
}

function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed right-4 top-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={[
            'rounded-2xl border p-4 shadow-xl backdrop-blur',
            'bg-white/90 text-slate-900 border-slate-200',
            'dark:bg-slate-900/90 dark:text-slate-50 dark:border-white/10',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                <span
                  className={[
                    'mr-2 inline-flex h-2 w-2 rounded-full align-middle',
                    t.kind === 'success' ? 'bg-emerald-500' : '',
                    t.kind === 'error' ? 'bg-rose-500' : '',
                    t.kind === 'info' ? 'bg-cyan-500' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
                {t.title}
              </p>
              {t.message ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t.message}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="rounded-xl p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-50"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function cleanErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Something went wrong. Please try again.'
  const msg = err.message || ''
  if (msg.includes('401') || msg.includes('Not logged in')) {
    return 'Please connect to Angel One first.'
  }
  if (msg.length > 200) return msg.slice(0, 200)
  return msg
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

type Exchange = 'NFO' | 'BFO'
type Underlying = 'NIFTY' | 'BANKNIFTY' | 'SENSEX'
type OptionType = 'CE' | 'PE'
type Side = 'BUY' | 'SELL'
type Product = 'DELIVERY' | 'INTRADAY'
type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-L'

type TradeTab = 'EQUITY' | 'OPTIONS' | 'ORDERS' | 'POSITIONS'

type OrdersSubTab = 'PENDING' | 'EXECUTED' | 'CANCELLED' | 'REJECTED'

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

type BrokerOrder = {
  orderid: string
  tradingsymbol: string
  exchange: string
  transactiontype: string
  producttype?: string
  ordertype?: string
  price?: string
  triggerprice?: string
  quantity?: string
  filledshares?: string
  status?: string
  orderstatus?: string
  updatetime?: string
  exchorderupdatetime?: string
  variety?: string
}

type BrokerOrderBookResponse = {
  status?: boolean
  message?: string
  data?: BrokerOrder[]
}

type PositionRow = {
  exch_seg?: string
  exchange?: string
  tradingsymbol?: string
  tradingSymbol?: string
  symboltoken?: string
  symbolToken?: string
  producttype?: string
  productType?: string
  product?: string
  posType?: string
  netqty?: string
  netQty?: string
  buyqty?: string
  sellqty?: string
  buyavgprice?: string
  sellavgprice?: string
  pnl?: string
}

type PositionsResponse = {
  status?: boolean
  message?: string
  data?: PositionRow[]
}

function normalizeVariety(v: unknown): 'NORMAL' | 'STOPLOSS' | 'ROBO' {
  const raw = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (raw === 'STOPLOSS' || raw === 'ROBO' || raw === 'NORMAL') return raw
  return 'NORMAL'
}

function normalizeOrderGroup(order: BrokerOrder): OrdersSubTab {
  const raw = String(order.orderstatus ?? order.status ?? '').trim().toUpperCase()
  if (
    raw.includes('COMPLETE') ||
    raw.includes('EXECUTED') ||
    raw.includes('TRADED') ||
    raw.includes('FILLED')
  ) {
    return 'EXECUTED'
  }
  if (raw.includes('CANCEL')) return 'CANCELLED'
  if (raw.includes('REJECT')) return 'REJECTED'
  if (raw.includes('OPEN') || raw.includes('TRIGGER') || raw.includes('PENDING') || raw.includes('PLACED')) {
    return 'PENDING'
  }
  // Safe default: show unknowns in Pending so user can act/see them.
  return 'PENDING'
}

function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function getPositionSymbol(p: PositionRow): string {
  return String(p.tradingsymbol ?? p.tradingSymbol ?? '').trim()
}

function getPositionToken(p: PositionRow): string {
  return String(p.symboltoken ?? p.symbolToken ?? '').trim()
}

function getPositionExchange(p: PositionRow): string {
  return String(p.exchange ?? p.exch_seg ?? '').trim().toUpperCase()
}

function getPositionNetQty(p: PositionRow): number {
  if (p.netqty != null) return parseNumber(p.netqty)
  if (p.netQty != null) return parseNumber(p.netQty)
  const buy = parseNumber(p.buyqty)
  const sell = parseNumber(p.sellqty)
  return buy - sell
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

function getOrderOutcomeMessage(resp: Record<string, unknown> | null | undefined): string {
  if (!resp) return 'No response received from broker.'
  const msg = resp.message
  if (typeof msg === 'string' && msg.trim()) return msg
  const err = resp.error
  if (typeof err === 'string' && err.trim()) return err
  const data = resp.data
  if (data && typeof data === 'object') {
    const dataMsg = (data as Record<string, unknown>).message
    if (typeof dataMsg === 'string' && dataMsg.trim()) return dataMsg
  }
  return 'Order was rejected by broker.'
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

export default function DashboardPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { connectStatus, connectMessage, openConnect, disconnect } = useAngelConnection()

  const [toasts, setToasts] = useState<ToastItem[]>([])
  function pushToast(kind: ToastKind, title: string, message?: string) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, kind, title, message }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }

  const [tab, setTab] = useState<TradeTab>('EQUITY')
  const [ordersSubTab, setOrdersSubTab] = useState<OrdersSubTab>('PENDING')
  const [ordersPage, setOrdersPage] = useState<number>(1)
  const [ordersRowsPerPage, setOrdersRowsPerPage] = useState<number>(25)

  const [exchange, setExchange] = useState<Exchange>('NFO')
  const [underlying, setUnderlying] = useState<Underlying>('NIFTY')
  const [expiry, setExpiry] = useState<string>('')
  const [strike, setStrike] = useState<number | null>(null)
  const [optionType, setOptionType] = useState<OptionType>('CE')
  const [expiries, setExpiries] = useState<string[]>([])
  const [strikes, setStrikes] = useState<number[]>([])
  const [contracts, setContracts] = useState<IndexOptionContract[]>([])
  const [strikeInput, setStrikeInput] = useState<string>('')
  const [indexLtp, setIndexLtp] = useState<number | null>(null)

  const [equityQuery, setEquityQuery] = useState<string>('')
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
  const [orderType, setOrderType] = useState<OrderType>('MARKET')
  const [limitPrice, setLimitPrice] = useState<number | null>(null)
  const [triggerPrice, setTriggerPrice] = useState<number | null>(null)

  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => undefined,
  })

  const [brokerOrders, setBrokerOrders] = useState<BrokerOrder[]>([])
  const [positions, setPositions] = useState<PositionRow[]>([])

  const [selectedLtp, setSelectedLtp] = useState<number | null>(null)
  const [ltpStatus, setLtpStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  const [marginsRaw, setMarginsRaw] = useState<Record<string, unknown> | null>(null)
  const [marginsStatus, setMarginsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  const [requiredMargin, setRequiredMargin] = useState<number | null>(null)
  const [requiredMarginSupported, setRequiredMarginSupported] = useState<boolean>(true)
  const [requiredMarginStatus, setRequiredMarginStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  const selectedInstrument = useMemo<
    | {
        exchange: string
        tradingsymbol: string
        symboltoken: string
      }
    | null
  >(() => {
    if (tab === 'EQUITY') {
      if (!selectedEquity) return null
      return {
        exchange: 'NSE',
        tradingsymbol: selectedEquity.tradingsymbol,
        symboltoken: selectedEquity.symboltoken,
      }
    }
    if (tab === 'OPTIONS') {
      if (!selected) return null
      return {
        exchange: selected.exchange,
        tradingsymbol: selected.tradingsymbol,
        symboltoken: selected.symboltoken,
      }
    }
    return null
  }, [selected, selectedEquity, tab])

  const availableMargin = useMemo<number | null>(() => {
    if (!marginsRaw) return null

    const root = marginsRaw
    const data = (root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root) as Record<
      string,
      unknown
    >

    return pickFirstNumber(data, [
      'availablecash',
      'availableCash',
      'available',
      'cashAvailable',
      'net',
      'availableMargin',
      'availablemargin',
    ])
  }, [marginsRaw])

  const remainingMargin = useMemo<number | null>(() => {
    if (availableMargin === null) return null
    if (requiredMargin === null) return null
    return availableMargin - requiredMargin
  }, [availableMargin, requiredMargin])

  async function refreshMargins() {
    setMarginsStatus('loading')
    try {
      const data = await apiGet<Record<string, unknown>>('/angel/margins')
      setMarginsRaw(data)
      setMarginsStatus('ok')
    } catch (e) {
      setMarginsRaw(null)
      setMarginsStatus('error')
      if (connectStatus === 'connected') {
        pushToast('error', 'Funds unavailable', cleanErrorMessage(e))
      }
    }
  }

  async function refreshLtp() {
    if (!selectedInstrument) {
      setSelectedLtp(null)
      setLtpStatus('idle')
      return
    }

    setLtpStatus('loading')
    try {
      const q = new URLSearchParams({
        exchange: selectedInstrument.exchange,
        tradingsymbol: selectedInstrument.tradingsymbol,
        symboltoken: selectedInstrument.symboltoken,
      })
      const data = await apiGet<{ ltp: number }>(`/market/ltp?${q.toString()}`)
      setSelectedLtp(typeof data.ltp === 'number' && Number.isFinite(data.ltp) ? data.ltp : null)
      setLtpStatus('ok')
    } catch {
      setSelectedLtp(null)
      setLtpStatus('error')
    }
  }

  async function refreshRequiredMargin() {
    if (!selectedInstrument) {
      setRequiredMargin(null)
      setRequiredMarginStatus('idle')
      return
    }

    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setRequiredMargin(null)
      setRequiredMarginStatus('idle')
      return
    }

    setRequiredMarginSupported(true)

    if (ltpStatus === 'loading' || ltpStatus === 'idle') {
      setRequiredMargin(null)
      setRequiredMarginStatus('loading')
      return
    }

    if (selectedLtp === null || !Number.isFinite(selectedLtp)) {
      setRequiredMargin(null)
      setRequiredMarginStatus('error')
      return
    }

    setRequiredMargin(qty * selectedLtp)
    setRequiredMarginStatus('ok')
  }

  async function refreshBrokerOrders() {
    try {
      const data = await apiGet<BrokerOrderBookResponse>('/angel/orderbook')
      setBrokerOrders(Array.isArray(data.data) ? data.data : [])
    } catch (e) {
      pushToast('error', 'Orderbook unavailable', cleanErrorMessage(e))
    }
  }

  async function cancelBrokerOrder(order: BrokerOrder) {
    const oid = String(order.orderid || '').trim()
    const variety = normalizeVariety(order.variety)
    if (!oid) {
      pushToast('error', 'Cancel failed', 'Order id is missing.')
      return
    }

    setConfirm({
      open: true,
      title: 'Cancel order',
      message: `Cancel ${order.tradingsymbol} (${oid})?`,
      confirmText: 'Cancel order',
      cancelText: 'Back',
      destructive: true,
      onConfirm: async () => {
        try {
          const resp = await apiPost<Record<string, unknown>>(`/angel/orders/${encodeURIComponent(oid)}/cancel`, { variety })
          const ok = typeof resp.status === 'boolean' ? resp.status : true
          if (ok) {
            pushToast('success', 'Order cancelled')
          } else {
            pushToast('error', 'Cancel failed', asString(resp.message) || 'Broker rejected cancel request.')
          }
        } catch (e) {
          pushToast('error', 'Cancel failed', cleanErrorMessage(e))
        }
        await refreshBrokerOrders()
      },
    })
  }

  async function refreshPositions() {
    try {
      const data = await apiGet<PositionsResponse>('/angel/positions')
      setPositions(Array.isArray(data.data) ? data.data : [])
    } catch (e) {
      pushToast('error', 'Positions unavailable', cleanErrorMessage(e))
    }
  }

  async function exitPosition(p: PositionRow) {
    const symbol = getPositionSymbol(p)
    const token = getPositionToken(p)
    const exchange = getPositionExchange(p)
    const net = getPositionNetQty(p)
    const posProduct = getPositionExitProductType(p)
    if (!symbol || !token || !exchange) {
      pushToast('error', 'Exit unavailable', 'Position is missing symbol/token/exchange from broker response.')
      return
    }
    if (!Number.isFinite(net) || net === 0) {
      pushToast('info', 'No open quantity', 'This position has no net quantity.')
      return
    }

    if (posProduct === null) {
      pushToast('error', 'Exit unavailable', 'Unable to determine position product type (DELIVERY/INTRADAY) from broker response.')
      return
    }

    const qty = Math.abs(net)
    const tx: Side = net > 0 ? 'SELL' : 'BUY'

    setConfirm({
      open: true,
      title: 'Exit position',
      message: `Exit ${symbol}\nSide: ${tx}\nQty: ${qty}\nExchange: ${exchange}`,
      confirmText: 'Exit',
      cancelText: 'Cancel',
      destructive: true,
      onConfirm: async () => {
        try {
          const placed = await apiPost<PlaceOrderResponse>('/angel/positions/exit', {
            exchange,
            tradingsymbol: symbol,
            symboltoken: token,
            quantity: qty,
            producttype: posProduct,
            transactiontype: tx,
          })
          const ok = isSuccessResponse(placed.item.response)
          if (ok) {
            pushToast('success', 'Exit placed', 'Exit order placed successfully.')
          } else {
            pushToast('error', 'Exit failed', getOrderOutcomeMessage(placed.item.response))
          }
          await refreshOrders()
          await refreshPositions()
        } catch (e) {
          pushToast('error', 'Exit failed', cleanErrorMessage(e))
        }
      },
    })
  }

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
      pushToast('error', 'Options unavailable', cleanErrorMessage(e))
    }
  }

  async function loadStrikes(nextExchange: Exchange, nextUnderlying: Underlying, nextExpiry: string) {
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
      pushToast('error', 'Strikes unavailable', cleanErrorMessage(e))
    }
  }

  async function loadIndexLtp(nextUnderlying: Underlying) {
    setIndexLtp(null)

    try {
      const data = await apiGet<MarketIndexLtpResponse>(`/market/index-ltp?underlying=${encodeURIComponent(nextUnderlying)}`)
      setIndexLtp(data.ltp)
    } catch (e) {
      pushToast('info', 'Index price unavailable', 'ATM filtering may be limited. You can still type a strike to select it.')
    }
  }

  async function searchEquity() {
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
      pushToast('error', 'Search failed', cleanErrorMessage(e))
    }
  }

  async function refreshOrders() {
    try {
      await apiGet<OrdersResponse>('/angel/orders')
    } catch {
      // ignore
    }
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
        await disconnect()
      },
    })
  }

  async function onPlaceOrder() {
    if (tab === 'EQUITY') {
      if (!selectedEquity) {
        pushToast('info', 'Select a stock', 'Search and select a stock before placing an order.')
        return
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        pushToast('error', 'Invalid quantity', 'Quantity must be greater than 0.')
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
            const placed = await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
              exchange: 'NSE',
              tradingsymbol: selectedEquity.tradingsymbol,
              symboltoken: selectedEquity.symboltoken,
              transactiontype: side,
              producttype: product,
              quantity,
              ordertype: orderType,
              price: orderType === 'LIMIT' || orderType === 'SL-L' ? limitPrice : undefined,
              triggerprice: orderType === 'SL' || orderType === 'SL-L' ? triggerPrice : undefined,
            })

            const ok = isSuccessResponse(placed.item.response)
            if (ok) {
              pushToast('success', 'Order placed', 'Your equity order was placed successfully.')
              setSide('BUY')
              setProduct('INTRADAY')
              setOrderType('MARKET')
              setLimitPrice(null)
              setTriggerPrice(null)
              setQuantity(1)
              setSelectedEquity(null)
              setEquityItems([])
              setEquityQuery('')
            } else {
              pushToast('error', 'Order failed', getOrderOutcomeMessage(placed.item.response))
            }

            await refreshOrders()
          } catch (e) {
            pushToast('error', 'Order failed', e instanceof Error ? e.message : 'Your order could not be placed.')
            await refreshOrders()
          }
        },
      })

      return
    }

    if (!selected) {
      pushToast('info', 'Select a contract', 'Choose expiry, strike, and CE/PE before placing an order.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      pushToast('error', 'Invalid quantity', 'Quantity must be greater than 0.')
      return
    }

    if (selectedLotSize !== null && quantity % selectedLotSize !== 0) {
      pushToast('error', 'Lot size required', `Quantity must be a multiple of lot size (${selectedLotSize}).`)
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
          const placed = await apiPost<PlaceOrderResponse>('/angel/orders/simple', {
            exchange: selected.exchange,
            tradingsymbol: selected.tradingsymbol,
            symboltoken: selected.symboltoken,
            transactiontype: side,
            producttype: product,
            quantity,
            ordertype: orderType,
            price: orderType === 'LIMIT' || orderType === 'SL-L' ? limitPrice : undefined,
            triggerprice: orderType === 'SL' || orderType === 'SL-L' ? triggerPrice : undefined,
          })

          const ok = isSuccessResponse(placed.item.response)
          if (ok) {
            pushToast('success', 'Order placed', 'Your options order was placed successfully.')
            setSide('BUY')
            setProduct('INTRADAY')
            setOrderType('MARKET')
            setLimitPrice(null)
            setTriggerPrice(null)
            setOptionType('CE')
            setStrike(null)
            setStrikeInput('')
            if (selectedLotSize !== null) {
              setQuantity(selectedLotSize)
            }
          } else {
            pushToast('error', 'Order failed', getOrderOutcomeMessage(placed.item.response))
          }

          await refreshOrders()
        } catch (e) {
          pushToast('error', 'Order failed', e instanceof Error ? e.message : 'Your order could not be placed.')
          await refreshOrders()
        }
      },
    })
  }

  useEffect(() => {
    // initial fetch is not required for ticket UI
  }, [])

  useEffect(() => {
    if (connectStatus !== 'connected') {
      setMarginsRaw(null)
      setMarginsStatus('idle')
      setRequiredMargin(null)
      setRequiredMarginStatus('idle')
      setRequiredMarginSupported(true)
      return
    }

    void refreshMargins()
  }, [connectStatus])

  useEffect(() => {
    if (connectStatus !== 'connected') {
      setSelectedLtp(null)
      setLtpStatus('idle')
      return
    }

    void refreshLtp()
  }, [connectStatus, selectedInstrument])

  useEffect(() => {
    if (connectStatus !== 'connected') {
      setRequiredMargin(null)
      setRequiredMarginStatus('idle')
      return
    }

    const t = window.setTimeout(() => {
      void refreshRequiredMargin()
    }, 450)

    return () => {
      window.clearTimeout(t)
    }
  }, [connectStatus, limitPrice, orderType, product, quantity, selectedInstrument, side])

  useEffect(() => {
    if (tab === 'ORDERS') {
      void refreshBrokerOrders()
    }
    if (tab === 'POSITIONS') {
      void refreshPositions()
    }
  }, [tab])

  useEffect(() => {
    setOrdersPage(1)
  }, [ordersSubTab])

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

  const tabButtonBase =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-4 focus:ring-cyan-200 dark:focus:ring-cyan-400/20'
  const tabButtonInactive =
    'border border-slate-200 bg-transparent text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10'
  const tabButtonActive = 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'

  const brokerOrdersByGroup = useMemo(() => {
    const grouped: Record<OrdersSubTab, BrokerOrder[]> = {
      PENDING: [],
      EXECUTED: [],
      CANCELLED: [],
      REJECTED: [],
    }
    for (const o of brokerOrders) {
      grouped[normalizeOrderGroup(o)].push(o)
    }
    return grouped
  }, [brokerOrders])

  const activeBrokerOrders = brokerOrdersByGroup[ordersSubTab]

  const ordersTotalPages = useMemo(() => {
    const per = Math.max(1, ordersRowsPerPage)
    return Math.max(1, Math.ceil(activeBrokerOrders.length / per))
  }, [activeBrokerOrders.length, ordersRowsPerPage])

  const pagedBrokerOrders = useMemo(() => {
    const per = Math.max(1, ordersRowsPerPage)
    const page = Math.min(Math.max(1, ordersPage), ordersTotalPages)
    const start = (page - 1) * per
    return activeBrokerOrders.slice(start, start + per)
  }, [activeBrokerOrders, ordersPage, ordersRowsPerPage, ordersTotalPages])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <Toasts items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      <div className="mx-auto max-w-6xl px-4 py-8">
        {hideHeader ? null : (
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Trading Dashboard</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Equity orders, index options, and order history.
              </p>
            </div>

            <div className="flex items-center gap-2">
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
                  onClick={openConnect}
                  disabled={connectStatus === 'connecting'}
                  className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-70"
                >
                  {connectStatus === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
          </header>
        )}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {hideHeader ? null : (
              <div>
                <p className="text-sm font-semibold">Connection</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Status: <span className="font-medium">{connectStatus}</span>
                </p>
                {connectMessage ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{connectMessage}</p> : null}
              </div>
            )}

            <div
              className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/5"
              role="tablist"
              aria-label="Dashboard tabs"
            >
              <button
                role="tab"
                aria-selected={tab === 'EQUITY'}
                type="button"
                onClick={() => setTab('EQUITY')}
                className={[tabButtonBase, tab === 'EQUITY' ? tabButtonActive : tabButtonInactive].join(' ')}
              >
                Equity
              </button>
              <button
                role="tab"
                aria-selected={tab === 'OPTIONS'}
                type="button"
                onClick={() => setTab('OPTIONS')}
                className={[tabButtonBase, tab === 'OPTIONS' ? tabButtonActive : tabButtonInactive].join(' ')}
              >
                Options
              </button>
              <button
                role="tab"
                aria-selected={tab === 'ORDERS'}
                type="button"
                onClick={() => setTab('ORDERS')}
                className={[tabButtonBase, tab === 'ORDERS' ? tabButtonActive : tabButtonInactive].join(' ')}
              >
                Orders
              </button>
              <button
                role="tab"
                aria-selected={tab === 'POSITIONS'}
                type="button"
                onClick={() => setTab('POSITIONS')}
                className={[tabButtonBase, tab === 'POSITIONS' ? tabButtonActive : tabButtonInactive].join(' ')}
              >
                Positions
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
                        ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                        : 'border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    PUT (PE)
                  </button>
                </div>
              </div>

            </div>
          ) : (
            tab === 'EQUITY' ? (
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
            ) : null
          )}
        </section>

        {tab === 'EQUITY' || tab === 'OPTIONS' ? (
          <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <h2 className="text-lg font-semibold">Order ticket</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Review details and place the order.</p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">Price (LTP)</p>
                      <p className="mt-1 text-sm font-semibold">
                        {selectedLtp !== null ? selectedLtp.toFixed(2) : '—'}
                        {ltpStatus === 'loading' ? <span className="ml-2 text-xs text-slate-500">Loading…</span> : null}
                        {ltpStatus === 'error' ? <span className="ml-2 text-xs text-rose-600">Unavailable</span> : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshLtp()}
                      disabled={connectStatus !== 'connected' || !selectedInstrument || ltpStatus === 'loading'}
                      className="rounded-xl border border-slate-200 bg-transparent px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600 dark:border-white/10 dark:text-slate-300">
                    <div className="flex items-center justify-between gap-2">
                      <span>Available funds</span>
                      <span className="font-mono">{formatINR(availableMargin)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>Required (est.)</span>
                      <span className="font-mono">
                        {requiredMarginSupported ? formatINR(requiredMargin) : 'Not supported'}
                        {requiredMarginStatus === 'loading' ? <span className="ml-2 text-[11px] text-slate-500">…</span> : null}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>Remaining</span>
                      <span
                        className={[
                          'font-mono',
                          remainingMargin !== null && remainingMargin < 0 ? 'text-rose-600 dark:text-rose-300' : '',
                        ].join(' ')}
                      >
                        {requiredMarginSupported ? formatINR(remainingMargin) : '—'}
                      </span>
                    </div>

                    {connectStatus !== 'connected' ? (
                      <p className="mt-2 text-[11px] text-slate-500">Connect to Angel One to view funds and margin.</p>
                    ) : marginsStatus === 'error' ? (
                      <p className="mt-2 text-[11px] text-rose-600">Funds endpoint unavailable.</p>
                    ) : null}
                  </div>
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
                  <div className="mt-2 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/5">
                    <button
                      type="button"
                      onClick={() => setSide('BUY')}
                      className={[
                        tabButtonBase,
                        side === 'BUY' ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300' : tabButtonInactive,
                      ].join(' ')}
                    >
                      Buy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSide('SELL')
                        setProduct(coerceProductForSide('SELL', product))
                      }}
                      className={[
                        tabButtonBase,
                        side === 'SELL' ? 'bg-rose-400 text-slate-950 hover:bg-rose-300' : tabButtonInactive,
                      ].join(' ')}
                    >
                      Sell
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold">Product</p>
                  <div className="mt-2 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/5">
                    <button
                      type="button"
                      disabled={side === 'SELL'}
                      onClick={() => setProduct('DELIVERY')}
                      className={[
                        tabButtonBase,
                        product === 'DELIVERY' ? tabButtonActive : tabButtonInactive,
                        side === 'SELL' ? 'opacity-60 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      Regular
                    </button>
                    <button
                      type="button"
                      onClick={() => setProduct('INTRADAY')}
                      className={[tabButtonBase, product === 'INTRADAY' ? tabButtonActive : tabButtonInactive].join(' ')}
                    >
                      Intraday
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void onPlaceOrder()}
                  className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
                >
                  Place order
                </button>
              </div>
            </div>

            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <h2 className="text-lg font-semibold">Tips</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  - **Connect** first to enable search, LTP and orders.
                </p>
                <p>
                  - For options, quantity must respect lot size.
                </p>
                <p>
                  - If you don’t see an index price, ATM filtering will still work with strike search.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'ORDERS' ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Orders</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Live orderbook from broker.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshBrokerOrders()}
                  className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-4 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/5" role="tablist" aria-label="Order status tabs">
              {(['PENDING', 'EXECUTED', 'CANCELLED', 'REJECTED'] as OrdersSubTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={ordersSubTab === t}
                  onClick={() => setOrdersSubTab(t)}
                  className={[tabButtonBase, ordersSubTab === t ? tabButtonActive : tabButtonInactive].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">Rows per page</span>
                <select
                  value={ordersRowsPerPage}
                  onChange={(e) => {
                    setOrdersRowsPerPage(Number(e.target.value))
                    setOrdersPage(1)
                  }}
                  className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                  disabled={ordersPage <= 1}
                  className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Prev
                </button>
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Page {Math.min(Math.max(1, ordersPage), ordersTotalPages)} / {ordersTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                  disabled={ordersPage >= ordersTotalPages}
                  className="rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Next
                </button>
              </div>
            </div>

            {activeBrokerOrders.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">No orders in this category.</p>
            ) : (
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                    <tr>
                      <th className="py-3 pl-3 pr-3">Time</th>
                      <th className="py-3 pr-3">Symbol</th>
                      <th className="py-3 pr-3">Qty</th>
                      <th className="py-3 pr-3">Side</th>
                      <th className="py-3 pr-3">Product</th>
                      <th className="py-3 pr-3">Type</th>
                      <th className="py-3 pr-3">Status</th>
                      <th className="py-3 pr-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBrokerOrders.map((o) => {
                      const symbol = String(o.tradingsymbol || '').trim()
                      const qty = String(o.quantity || '').trim()
                      const filled = String(o.filledshares || '').trim()
                      const sideText = String(o.transactiontype || '').trim()
                      const productType = String(o.producttype || '').trim()
                      const typeText = String(o.ordertype || '').trim()
                      const rawStatus = String(o.orderstatus ?? o.status ?? '').trim()
                      const time = String(o.exchorderupdatetime || o.updatetime || '').trim()
                      const canCancel = normalizeOrderGroup(o) === 'PENDING'

                      return (
                        <tr key={String(o.orderid || symbol)} className="border-t border-slate-200 dark:border-white/10">
                          <td className="py-2 pl-3 pr-3 align-top font-mono text-xs">{time ? time : '-'}</td>
                          <td className="py-2 pr-3 align-top font-mono text-xs">{symbol || '-'}</td>
                          <td className="py-2 pr-3 align-top font-mono text-xs">{qty || '-'}{filled ? ` / ${filled}` : ''}</td>
                          <td className="py-2 pr-3 align-top font-mono text-xs">{sideText || '-'}</td>
                          <td className="py-2 pr-3 align-top">{productType || '-'}</td>
                          <td className="py-2 pr-3 align-top">{typeText || '-'}</td>
                          <td className="py-2 pr-3 align-top">{rawStatus || '-'}</td>
                          <td className="py-2 pr-3 align-top">
                            {canCancel ? (
                              <button
                                type="button"
                                onClick={() => void cancelBrokerOrder(o)}
                                className="rounded-xl border border-rose-300 bg-transparent px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10"
                              >
                                Cancel
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500 dark:text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {tab === 'POSITIONS' ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Positions</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Live positions from broker.</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshPositions()}
                className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
              >
                Refresh
              </button>
            </div>

            {positions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">No active positions.</p>
            ) : (
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                    <tr>
                      <th className="py-3 pl-3 pr-3">Symbol</th>
                      <th className="py-3 pr-3">Exchange</th>
                      <th className="py-3 pr-3">Net Qty</th>
                      <th className="py-3 pr-3">P&L</th>
                      <th className="py-3 pr-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, idx) => {
                      const symbol = getPositionSymbol(p)
                      const exchange = getPositionExchange(p)
                      const net = getPositionNetQty(p)
                      const pnl = parseNumber(p.pnl)
                      const canExit = Boolean(symbol) && Boolean(exchange) && Boolean(getPositionToken(p)) && net !== 0

                      return (
                        <tr key={`${symbol}-${idx}`} className="border-t border-slate-200 dark:border-white/10">
                          <td className="py-2 pl-3 pr-3 align-top font-mono text-xs">{symbol || '-'}</td>
                          <td className="py-2 pr-3 align-top font-mono text-xs">{exchange || '-'}</td>
                          <td className="py-2 pr-3 align-top font-mono text-xs">{net}</td>
                          <td className="py-2 pr-3 align-top font-mono text-xs">{Number.isFinite(pnl) ? pnl.toFixed(2) : '-'}</td>
                          <td className="py-2 pr-3 align-top">
                            <button
                              type="button"
                              disabled={!canExit}
                              onClick={() => void exitPosition(p)}
                              className="rounded-xl border border-rose-300 bg-transparent px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10"
                            >
                              Exit
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

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
