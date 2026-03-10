import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider'
import { useTheme } from '../../shared/theme/ThemeProvider'
import { usePageTitle } from '../../hooks/usePageTitle'

type Props = {
  title: string
  subtitle?: string
  backTo?: string
  children: ReactNode
}

export default function StrategiesLayout({ title, subtitle, backTo, children }: Props) {
  usePageTitle(title)
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { connectStatus, connectMessage, openConnect, disconnect } = useAngelConnection()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p> : null}
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Status: <span className="font-medium">{connectStatus}</span>
            </p>
            {connectMessage ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{connectMessage}</p> : null}
          </div>

          <div className="flex items-center gap-2">
            {backTo ? (
              <button
                type="button"
                onClick={() => navigate(backTo)}
                className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
              >
                Back
              </button>
            ) : null}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-transparent transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {connectStatus === 'connected' ? (
              <button
                type="button"
                onClick={() => void disconnect()}
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

        <section className="mt-6">{children}</section>
      </div>
    </div>
  )
}
