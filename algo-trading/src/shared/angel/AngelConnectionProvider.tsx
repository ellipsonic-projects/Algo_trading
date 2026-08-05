import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import MpinModal from './MpinModal'
import { useAuth } from '../../context/AuthContext'

type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'error'

type AngelConnectionContextValue = {
  connectStatus: ConnectStatus
  connectMessage: string
  openConnect: () => void
  disconnect: () => Promise<void>
}

import { API_BASE } from '../../config/env'

const API_BASE_BROKER = `${API_BASE}/api/v1/broker/angel`

async function apiRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('jwt')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`${API_BASE_BROKER}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include'
  })
  if (!res.ok) {
    const errText = await res.text()
    let msg = errText
    try {
      const errJson = JSON.parse(errText)
      msg = errJson.message || errText
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

const AngelConnectionContext = createContext<AngelConnectionContextValue | null>(null)

export function AngelConnectionProvider({ children }: { children: ReactNode }) {
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>('idle')
  const [connectMessage, setConnectMessage] = useState('')
  const [mpinOpen, setMpinOpen] = useState(false)
  const [hasProfile, setHasProfile] = useState(false)

  const openConnect = useCallback(() => {
    setMpinOpen(true)
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await apiRequest<Record<string, unknown>>('/disconnect', 'POST')
    } catch {
      // ignore
    }
    setConnectStatus('idle')
    setConnectMessage('Disconnected')
  }, [])

  const submitMpin = useCallback(async (data: { clientCode?: string; apiKey?: string; mpin: string; totp: string }) => {
    setConnectStatus('connecting')
    setConnectMessage('')
    try {
      if (hasProfile) {
        await apiRequest<any>('/reauthenticate', 'POST', { mpin: data.mpin, totp: data.totp })
      } else {
        await apiRequest<any>('/connect', 'POST', {
          clientCode: data.clientCode,
          apiKey: data.apiKey,
          mpin: data.mpin,
          totp: data.totp
        })
        setHasProfile(true)
      }
      setConnectStatus('connected')
      setConnectMessage('Connected')
      setMpinOpen(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connect failed'
      setConnectStatus('error')
      setConnectMessage(msg)
      throw e
    }
  }, [hasProfile])

  const { user, loading } = useAuth()
  const location = useLocation()
  const isOnLoginPage = location.pathname === '/login'

  useEffect(() => {
    if (loading || !user || isOnLoginPage) {
      setMpinOpen(false)
      setConnectStatus('idle')
      return
    }

    let cancelled = false

    const checkAndConnect = async () => {
      try {
        const token = localStorage.getItem('jwt')
        const headers: Record<string, string> = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        const res = await fetch(`${API_BASE_BROKER}/status`, { headers, credentials: 'include' })
        if (res.ok) {
          const json = await res.json() as { status: string, data: { sessionStatus: string; hasProfile: boolean } }
          if (cancelled) return
          
          setHasProfile(json.data.hasProfile)
          const isConnected = json.status === 'success' && json.data.sessionStatus === 'CONNECTED'
          
          if (isConnected) {
            setConnectStatus('connected')
            setConnectMessage('Session active')
          } else {
            if (!isOnLoginPage) {
              setMpinOpen(true)
            }
          }
        }
      } catch {
        if (!cancelled && !isOnLoginPage) {
          setMpinOpen(true)
        }
      }
    }

    checkAndConnect()

    const intervalId = setInterval(async () => {
      try {
        const token = localStorage.getItem('jwt')
        const headers: Record<string, string> = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        const res = await fetch(`${API_BASE_BROKER}/status`, { headers, credentials: 'include' })
        if (res.ok) {
          const json = await res.json() as { status: string, data: { sessionStatus: string; hasProfile: boolean } }
          if (cancelled) return
          
          setHasProfile(json.data.hasProfile)
          const isConnected = json.status === 'success' && json.data.sessionStatus === 'CONNECTED'
          
          if (!isConnected && connectStatus === 'connected') {
            setConnectStatus('idle')
            setConnectMessage('')
            if (!isOnLoginPage) {
              setMpinOpen(true)
            }
          }
        }
      } catch {
        // ignore
      }
    }, 300_000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [user, loading, connectStatus, isOnLoginPage])

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
        hasProfile={hasProfile}
        onCancel={() => setMpinOpen(false)}
        onSubmit={async (data) => {
          await submitMpin(data)
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
