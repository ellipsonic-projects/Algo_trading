import type { ButtonHTMLAttributes } from 'react'

import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  fullWidth?: boolean
}

export default function Button({
  variant = 'primary',
  fullWidth = false,
  className,
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    variant === 'primary' ? styles.primary : styles.secondary,
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return <button className={classes} {...props} />
}
