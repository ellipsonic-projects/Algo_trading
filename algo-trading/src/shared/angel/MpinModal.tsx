import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

export default function MpinModal({
  open,
  onCancel,
  onSubmit,
}: {
  open: boolean
  onCancel: () => void
  onSubmit: (mpin: string) => Promise<void> | void
}) {
  const [digits, setDigits] = useState<string[]>(['', '', '', ''])
  const [isWorking, setIsWorking] = useState(false)
  const inputs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ]

  useEffect(() => {
    if (!open) return
    setDigits(['', '', '', ''])
    setIsWorking(false)
    setTimeout(() => inputs[0].current?.focus(), 0)
  }, [open])

  const mpin = digits.join('')
  const canSubmit = mpin.length === 4 && digits.every((d) => d.length === 1)

  async function handleSubmit() {
    if (!canSubmit || isWorking) return
    setIsWorking(true)
    try {
      await onSubmit(mpin)
    } finally {
      setIsWorking(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enter MPIN"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Connect to Angel One</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Enter your 4-digit MPIN to continue.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            className="rounded-xl p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
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
              className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50 text-center text-lg font-semibold text-slate-900 outline-none transition-colors focus:ring-4 focus:ring-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:focus:ring-cyan-400/20"
              aria-label={`MPIN digit ${idx + 1}`}
              disabled={isWorking}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            className="rounded-xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-70 dark:border-white/10 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isWorking}
            className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-70"
          >
            {isWorking ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
