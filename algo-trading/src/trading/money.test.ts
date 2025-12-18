import { describe, expect, it } from 'vitest'

import { formatINR, parseMoney, pickFirstNumber } from './money'

describe('parseMoney', () => {
  it('parses numbers', () => {
    expect(parseMoney(12.5)).toBe(12.5)
  })

  it('parses numeric strings', () => {
    expect(parseMoney('100')).toBe(100)
  })

  it('returns null for non-numeric', () => {
    expect(parseMoney('abc')).toBeNull()
  })
})

describe('pickFirstNumber', () => {
  it('picks the first matching key', () => {
    expect(pickFirstNumber({ a: 'x', b: '10', c: 20 }, ['a', 'b', 'c'])).toBe(10)
  })

  it('returns null if none match', () => {
    expect(pickFirstNumber({ a: 'x' }, ['b', 'c'])).toBeNull()
  })
})

describe('formatINR', () => {
  it('formats INR or returns dash', () => {
    expect(formatINR(null)).toBe('—')
    expect(formatINR(undefined)).toBe('—')
    expect(formatINR(Number.NaN)).toBe('—')
    expect(formatINR(1234)).toContain('₹')
  })
})
