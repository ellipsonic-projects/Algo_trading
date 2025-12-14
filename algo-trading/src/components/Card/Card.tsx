import type { HTMLAttributes, ReactNode } from 'react'

import styles from './Card.module.css'

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export default function Card({ children, className, ...props }: CardProps) {
  return (
    <div className={[styles.card, className ?? ''].filter(Boolean).join(' ')} {...props}>
      <div className={styles.accent} />
      <div className={styles.inner}>{children}</div>
    </div>
  )
}
