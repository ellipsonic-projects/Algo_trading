export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function pickFirstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = parseMoney(obj[k])
    if (n !== null) return n
  }
  return null
}

export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}
