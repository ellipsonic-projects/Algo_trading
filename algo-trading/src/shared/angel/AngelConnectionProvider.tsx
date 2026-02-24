import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

import MpinModal from './MpinModal'

type AngelLoginResponse = {
  status: boolean
  message?: string
  client_code?: string
}

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

  const submitMpin = useCallback(async (mpin: string, silent = false) => {
    if (!silent) {
      setConnectStatus('connecting')
      setConnectMessage('')
    }
    try {
      const login = await apiPost<AngelLoginResponse>('/angel/login', { mpin })
      setConnectStatus('connected')
      if (!silent) {
        setConnectMessage(login.message ?? 'Connected')
      }
      setMpinOpen(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connect failed'
      if (!silent) {
        setConnectStatus('error')
        setConnectMessage('')
      }
      throw new Error(msg)
    }
  }, [])

  // Auto-login & 5 min reconnect
  useEffect(() => {
    const mpin = import.meta.env.VITE_ANGEL_MPIN ?? '1504'

    // Auto login on mount
    submitMpin(mpin, false).catch(console.error)

    // Auto reconnect every 5 minutes
    const intervalId = setInterval(() => {
      submitMpin(mpin, true).catch(console.error)
    }, 300_000)

    return () => clearInterval(intervalId)
  }, [submitMpin])

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
