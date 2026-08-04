import { useEffect, useRef, useState } from 'react'
import { X, Shield, Key } from 'lucide-react'

export default function MpinModal({
  open,
  hasProfile,
  onCancel,
  onSubmit,
}: {
  open: boolean
  hasProfile: boolean
  onCancel: () => void
  onSubmit: (data: { clientCode?: string; apiKey?: string; mpin: string; totp: string }) => Promise<void> | void
}) {
  const [clientCode, setClientCode] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [totp, setTotp] = useState('')
  const [digits, setDigits] = useState<string[]>(['', '', '', ''])
  const [isWorking, setIsWorking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const inputs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ]

  useEffect(() => {
    if (!open) return
    setDigits(['', '', '', ''])
    setTotp('')
    setErrorMsg('')
    setIsWorking(false)
    if (hasProfile) {
      setTimeout(() => inputs[0].current?.focus(), 0)
    }
  }, [open, hasProfile])

  const mpin = digits.join('')
  const isMpinComplete = mpin.length === 4 && digits.every((d) => d.length === 1)
  const isTotpComplete = totp.length === 6 && /^\d+$/.test(totp)
  
  const canSubmit = hasProfile 
    ? (isMpinComplete && isTotpComplete)
    : (clientCode.trim() !== '' && apiKey.trim() !== '' && isMpinComplete && isTotpComplete)

  async function handleSubmit() {
    if (!canSubmit || isWorking) return
    setIsWorking(true)
    setErrorMsg('')
    try {
      await onSubmit({
        clientCode: hasProfile ? undefined : clientCode.trim(),
        apiKey: hasProfile ? undefined : apiKey.trim(),
        mpin,
        totp: totp.trim()
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setIsWorking(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Broker"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-500">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">
                {hasProfile ? 'Reauthenticate Broker' : 'Connect Angel One'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {hasProfile ? 'Provide your session credentials to reconnect.' : 'Onboard your Angel One trading account.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            className="rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 border border-rose-500/20 text-xs text-rose-500 font-medium">
            {errorMsg}
          </div>
        )}

        <div className="mt-5 space-y-4">
          {!hasProfile && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Client Code</label>
                <input
                  type="text"
                  placeholder="e.g. M12345"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:focus:ring-cyan-400/20"
                  disabled={isWorking}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">API Key</label>
                <input
                  type="text"
                  placeholder="Paste your SmartAPI app API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:focus:ring-cyan-400/20"
                  disabled={isWorking}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 text-center">4-Digit MPIN</label>
            <div className="mt-1.5 flex items-center justify-center gap-2.5">
              {digits.map((d, idx) => (
                <input
                  key={idx}
                  ref={inputs[idx]}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={d}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 1)
                    setDigits((prev) => {
                      const next = [...prev]
                      next[idx] = v
                      return next
                    })
                    if (v && idx < inputs.length - 1) inputs[idx + 1].current?.focus()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
                      inputs[idx - 1].current?.focus()
                    }
                  }}
                  className="h-11 w-11 rounded-xl border border-slate-200 bg-slate-50 text-center text-lg font-semibold text-slate-900 outline-none transition-colors focus:ring-2 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:focus:ring-cyan-400/20"
                  aria-label={`MPIN digit ${idx + 1}`}
                  disabled={isWorking}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Google Authenticator TOTP Code</label>
            <div className="relative mt-1">
              <input
                type="text"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="6-digit code"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3.5 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:focus:ring-cyan-400/20"
                disabled={isWorking}
              />
              <Key className="absolute left-3.5 top-2.5 h-4.5 w-4.5 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-70 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isWorking}
            className="rounded-xl bg-cyan-400 px-5 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-50"
          >
            {isWorking ? 'Connecting...' : 'Connect Broker'}
          </button>
        </div>
      </div>
    </div>
  )
}
