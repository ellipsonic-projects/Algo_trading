import type { InputHTMLAttributes, ReactNode } from 'react'

import styles from './TextField.module.css'

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string
  label: string
  hint?: ReactNode
  error?: string
}

export default function TextField({ label, hint, error, className, id, ...props }: TextFieldProps) {
  const describedByIds: string[] = []

  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined

  if (hintId) describedByIds.push(hintId)
  if (errorId) describedByIds.push(errorId)

  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {hint ? (
          <div id={hintId} className={styles.hint}>
            {hint}
          </div>
        ) : null}
      </div>

      <input
        id={id}
        className={[styles.input, error ? styles.inputError : ''].filter(Boolean).join(' ')}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedByIds.length > 0 ? describedByIds.join(' ') : undefined}
        {...props}
      />

      {error ? (
        <p id={errorId} className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
