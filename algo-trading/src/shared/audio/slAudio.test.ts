import { describe, expect, it } from 'vitest'

import { isStopLossExitReason } from './slAudio'

describe('isStopLossExitReason', () => {
  it('returns true for SL variants', () => {
    expect(isStopLossExitReason('SL')).toBe(true)
    expect(isStopLossExitReason('sl')).toBe(true)
    expect(isStopLossExitReason(' STOP_LOSS ')).toBe(true)
    expect(isStopLossExitReason('stoploss')).toBe(true)
  })

  it('returns false for non-SL reasons', () => {
    expect(isStopLossExitReason('Target')).toBe(false)
    expect(isStopLossExitReason('')).toBe(false)
    expect(isStopLossExitReason(null)).toBe(false)
    expect(isStopLossExitReason(undefined)).toBe(false)
  })
})
