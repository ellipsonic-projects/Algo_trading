import { describe, expect, it } from 'vitest'

import { coerceProductForSide, getPositionExitProductType } from './rules'

describe('getPositionExitProductType', () => {
  it('maps CNC to DELIVERY', () => {
    expect(getPositionExitProductType({ posType: 'CNC' })).toBe('DELIVERY')
  })

  it('maps MIS to INTRADAY', () => {
    expect(getPositionExitProductType({ producttype: 'MIS' })).toBe('INTRADAY')
  })

  it('maps NRML to CARRYFORWARD', () => {
    expect(getPositionExitProductType({ productType: 'NRML' })).toBe('CARRYFORWARD')
  })

  it('returns null when unknown', () => {
    expect(getPositionExitProductType({ product: 'SOMETHING' })).toBeNull()
  })
})

describe('coerceProductForSide', () => {
  it('forces INTRADAY for SELL', () => {
    expect(coerceProductForSide('SELL', 'DELIVERY')).toBe('INTRADAY')
  })

  it('keeps existing product for BUY', () => {
    expect(coerceProductForSide('BUY', 'DELIVERY')).toBe('DELIVERY')
  })
})
