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
  it('uses mother candle high/low and requires child open/close inside', () => {
    const candles: Candle[] = [
      c('t1', 10, 20, 9, 19),
      c('t2', 12, 30, 8, 18),
      c('t3', 11, 25, 7, 10),
      c('t4', 15, 22, 6, 16),
      c('t5', 18, 21, 5, 12),
    ]

    const range = computePremiumRange(candles, 5)
    expect(range).not.toBeNull()
    expect(range?.rangeHigh).toBe(20)
    expect(range?.rangeLow).toBe(9)
    expect(range?.size).toBe(11)
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

  it('marks invalid when a child candle open/close is outside mother candle', () => {
    const candles: Candle[] = [
      c('t1', 100, 120, 90, 110),
      c('t2', 95, 130, 80, 111),
      c('t3', 105, 125, 85, 89),
      c('t4', 100, 122, 88, 109),
    ]

    const range = computePremiumRange(candles, 4)
    expect(range).not.toBeNull()
    expect(range?.rangeHigh).toBe(120)
    expect(range?.rangeLow).toBe(90)
    expect(range?.isValid).toBe(false)
  })
})

describe('detectBreakoutCloseOnly', () => {
  it('signals breakout only when close > rangeHigh', () => {
    const range = computePremiumRange([c('t1', 0, 10, 5, 9), c('t2', 0, 11, 6, 10), c('t3', 0, 12, 7, 11), c('t4', 0, 13, 8, 12), c('t5', 0, 14, 9, 13)], 5)
    expect(range).not.toBeNull()

    expect(detectBreakoutCloseOnly({ candleClose: 9.99, range: range! })).toBe(false)
    expect(detectBreakoutCloseOnly({ candleClose: 10.01, range: range! })).toBe(true)
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

  it('returns null when risk is below 10 points', () => {
    const res = computeStopLossAndTarget({ entryPrice: 120, rangeLow: 119 })
    // rawSL = 117, entry-35 = 85 -> stopLoss = 117, risk = 3 (< 10)
    expect(res).toBeNull()
  })
})

describe('shouldProcessCandle', () => {
  it('processes when ts changes', () => {
    expect(shouldProcessCandle({ lastProcessedTs: null, nextTs: 'a' })).toBe(true)
    expect(shouldProcessCandle({ lastProcessedTs: 'a', nextTs: 'a' })).toBe(false)
    expect(shouldProcessCandle({ lastProcessedTs: 'a', nextTs: 'b' })).toBe(true)
  })
})
