import { describe, expect, it } from 'vitest'

import {
  computePremiumRange,
  computeStopLossAndTarget,
  detectBreakoutCloseOnly,
  shouldProcessCandle,
  type Candle,
} from './premiumRangeBreakout'

function c(ts: string, o: number, h: number, l: number, cl: number): Candle {
  return { ts, open: o, high: h, low: l, close: cl }
}

describe('computePremiumRange', () => {
  it('computes range from high/low only', () => {
    const candles: Candle[] = [
      c('t1', 10, 20, 9, 19),
      c('t2', 19, 21, 11, 12),
      c('t3', 12, 18, 10, 11),
      c('t4', 11, 17, 8, 16),
      c('t5', 16, 19, 7, 18),
    ]

    const range = computePremiumRange(candles, 5)
    expect(range).not.toBeNull()
    expect(range?.rangeHigh).toBe(21)
    expect(range?.rangeLow).toBe(7)
    expect(range?.size).toBe(14)
    expect(range?.isValid).toBe(true)
  })

  it('marks invalid when range exceeds 30', () => {
    const candles: Candle[] = [
      c('t1', 0, 100, 60, 70),
      c('t2', 0, 95, 50, 80),
      c('t3', 0, 90, 40, 60),
      c('t4', 0, 85, 30, 50),
      c('t5', 0, 80, 10, 40),
    ]

    const range = computePremiumRange(candles, 5)
    expect(range?.isValid).toBe(false)
  })
})

describe('detectBreakoutCloseOnly', () => {
  it('signals CE only when close > rangeHigh', () => {
    const range = computePremiumRange([c('t1', 0, 10, 5, 9), c('t2', 0, 11, 6, 10), c('t3', 0, 12, 7, 11), c('t4', 0, 13, 8, 12), c('t5', 0, 14, 9, 13)], 5)
    expect(range).not.toBeNull()

    expect(detectBreakoutCloseOnly({ candleClose: 14, range: range! })).toBeNull()
    expect(detectBreakoutCloseOnly({ candleClose: 14.01, range: range! })).toBe('CE')
  })

  it('signals PE only when close < rangeLow', () => {
    const range = computePremiumRange([c('t1', 0, 10, 5, 9), c('t2', 0, 11, 6, 10), c('t3', 0, 12, 7, 11), c('t4', 0, 13, 8, 12), c('t5', 0, 14, 9, 13)], 5)
    expect(range).not.toBeNull()

    expect(detectBreakoutCloseOnly({ candleClose: 5, range: range! })).toBeNull()
    expect(detectBreakoutCloseOnly({ candleClose: 4.99, range: range! })).toBe('PE')
  })
})

describe('computeStopLossAndTarget', () => {
  it('caps SL distance to 35 points', () => {
    const res = computeStopLossAndTarget({ entryPrice: 200, rangeLow: 100 })
    expect(res).not.toBeNull()
    // rawSL = 98, entry-35 = 165 -> max = 165
    expect(res?.stopLoss).toBe(165)
    // risk = 35 -> 1:1 target = entry + 35
    expect(res?.target).toBe(235)
  })

  it('uses rawSL when within max distance', () => {
    const res = computeStopLossAndTarget({ entryPrice: 120, rangeLow: 110 })
    // rawSL = 108, entry-35 = 85 -> max = 108
    expect(res?.stopLoss).toBe(108)
    // risk = 12 -> 1:1 target = entry + 12
    expect(res?.target).toBe(132)
  })
})

describe('shouldProcessCandle', () => {
  it('processes when ts changes', () => {
    expect(shouldProcessCandle({ lastProcessedTs: null, nextTs: 'a' })).toBe(true)
    expect(shouldProcessCandle({ lastProcessedTs: 'a', nextTs: 'a' })).toBe(false)
    expect(shouldProcessCandle({ lastProcessedTs: 'a', nextTs: 'b' })).toBe(true)
  })
})
