import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

import MpinModal from './MpinModal'
import { useAuth } from '../../context/AuthContext'

type AngelLoginResponse = {
  status: boolean
  message?: string
  client_code?: string
}

// Issue #7 FIX: VITE_ANGEL_MPIN removed. The MPIN must never be stored in the
// client bundle or any environment variable that gets inlined at build time.
type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'error'

type AngelConnectionContextValue = {
  connectStatus: ConnectStatus
  connectMessage: string
  openConnect: () => void
  disconnect: () => Promise<void>
}

const API_BASE = import.meta.env.VITE_ANGEL_ONE_API_BASE ?? 'http://localhost:8000'

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as T
}

/** Issue #7 FIX: Check session status without exposing credentials. */
async function apiGetSessionStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/angel/session-status`)
    if (!res.ok) return false
    const data = await res.json() as { connected: boolean }
    return data.connected === true
  } catch {
    return false
  }
}

const AngelConnectionContext = createContext<AngelConnectionContextValue | null>(null)

export function AngelConnectionProvider({ children }: { children: ReactNode }) {
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>('idle')
  const [connectMessage, setConnectMessage] = useState('')
  const [mpinOpen, setMpinOpen] = useState(false)

  const openConnect = useCallback(() => {
    setMpinOpen(true)
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await apiPost<Record<string, unknown>>('/angel/logout')
    } catch {
      // ignore
    }
    setConnectStatus('idle')
    setConnectMessage('Disconnected')
  }, [])

  const submitMpin = useCallback(async (mpin: string) => {
    setConnectStatus('connecting')
    setConnectMessage('')
    try {
      const login = await apiPost<AngelLoginResponse>('/angel/login', { mpin })
      setConnectStatus('connected')
      setConnectMessage(login.message ?? 'Connected')
      setMpinOpen(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connect failed'
      setConnectStatus('error')
      setConnectMessage('')
      throw new Error(msg)
    }
  }, [])

  const { user, loading } = useAuth()

  // On mount or user login state change: check broker session status ONLY if the
  // user is logged into the app. If not logged in or still loading auth, do not prompt.
  useEffect(() => {
    if (loading || !user) {
      setMpinOpen(false)
      setConnectStatus('idle')
      return
    }

    let cancelled = false

    const checkAndConnect = async () => {
      const isConnected = await apiGetSessionStatus()
      if (cancelled) return

      if (isConnected) {
        // Session already active (e.g., server kept the session alive)
        setConnectStatus('connected')
        setConnectMessage('Session active')
      } else {
        // Session not active — prompt the logged-in user to enter their MPIN manually
        setMpinOpen(true)
      }
    }

    checkAndConnect()

    // Re-check session status every 5 minutes.
    // If the session has dropped, re-open the prompt (no auto-submit).
    const intervalId = setInterval(async () => {
      const isConnected = await apiGetSessionStatus()
      if (cancelled) return
      if (!isConnected && connectStatus === 'connected') {
        setConnectStatus('idle')
        setConnectMessage('')
        setMpinOpen(true)
      }
    }, 300_000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [user, loading])

  const value = useMemo<AngelConnectionContextValue>(
    () => ({
      connectStatus,
      connectMessage,
      openConnect,
      disconnect,
    }),
    [connectMessage, connectStatus, disconnect, openConnect],
  )

  return (
    <AngelConnectionContext.Provider value={value}>
      {children}
      <MpinModal
        open={mpinOpen}
        onCancel={() => setMpinOpen(false)}
        onSubmit={async (mpin) => {
          await submitMpin(mpin)
        }}
      />
    </AngelConnectionContext.Provider>
  )
}

export function useAngelConnection(): AngelConnectionContextValue {
  const ctx = useContext(AngelConnectionContext)
  if (!ctx) throw new Error('useAngelConnection must be used within AngelConnectionProvider')
  return ctx
}
