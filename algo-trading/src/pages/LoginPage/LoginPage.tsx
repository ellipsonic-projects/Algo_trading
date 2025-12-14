import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, Moon } from "lucide-react";

type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function setDocumentTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [theme, setTheme] = useState<Theme>(() => {
    const t = getInitialTheme()
    setDocumentTheme(t)
    return t
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const errors = useMemo(() => {
    const next: { email?: string; password?: string } = {}

    if (!email.trim()) next.email = 'Email is required.'
    else if (!isValidEmail(email)) next.email = 'Enter a valid email address.'

    if (!password) next.password = 'Password is required.'
    else if (password.length < 8) next.password = 'Use at least 8 characters.'

    return next
  }, [email, password])

  const canSubmit = !errors.email && !errors.password

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setDocumentTheme(next)
    localStorage.setItem('theme', next)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched({ email: true, password: true })

    if (!canSubmit) return

    setIsSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 500))
      navigate('/dashboard')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="mx-auto w-fit items-center gap-6">
          <section
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-slate-900"
            aria-label="Login form"
          >
            <div className="h-1 bg-gradient-to-r from-cyan-400 to-violet-400" />
            <div className="p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Sign in</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Use your email and password to continue.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-transparent transition-colors hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/10"
                >
                  {theme === "dark" ? (
                    <Sun className="h-5 w-5 text-slate-100" />
                  ) : (
                    <Moon className="h-5 w-5 text-slate-900" />
                  )}
                </button>
              </div>

              <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    aria-invalid={Boolean(touched.email && errors.email) || undefined}
                    aria-describedby={touched.email && errors.email ? 'email-error' : undefined}
                    className={[
                      'w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors',
                      'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-500',
                      'hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200',
                      'dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:placeholder:text-slate-400 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20',
                      touched.email && errors.email ? 'border-rose-400 focus:ring-rose-200 dark:border-rose-400 dark:focus:ring-rose-400/20' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                  {touched.email && errors.email ? (
                    <p id="email-error" className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                      {errors.email}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    aria-invalid={Boolean(touched.password && errors.password) || undefined}
                    aria-describedby={touched.password && errors.password ? 'password-error' : undefined}
                    className={[
                      'w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors',
                      'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-500',
                      'hover:bg-slate-100 focus:ring-4 focus:ring-cyan-200',
                      'dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:placeholder:text-slate-400 dark:hover:bg-white/10 dark:focus:ring-cyan-400/20',
                      touched.password && errors.password
                        ? 'border-rose-400 focus:ring-rose-200 dark:border-rose-400 dark:focus:ring-rose-400/20'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                  {touched.password && errors.password ? (
                    <p id="password-error" className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                      {errors.password}
                    </p>
                  ) : null}
                </div>

                <div className="mt-1 flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting || undefined}
                    className="w-full rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting ? 'Signing in…' : 'Sign in'}
                  </button>

                  <div className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <div></div>
                    <button
                      className="font-medium text-slate-900 underline underline-offset-4 dark:text-slate-50"
                      type="button"
                    >
                      Request access
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
