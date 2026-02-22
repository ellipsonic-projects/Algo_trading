import { describe, expect, it } from 'vitest'
import { computeHeikenAshi, detectHeikenAshiTrend } from './heikenAshi'
import type { Candle } from './premiumRangeBreakout'

describe('Heiken Ashi Logic', () => {
    const mockCandles: Candle[] = [
        { ts: '1', open: 100, high: 110, low: 90, close: 105 },
        { ts: '2', open: 105, high: 115, low: 100, close: 110 },
        { ts: '3', open: 110, high: 120, low: 105, close: 115 },
    ]

    it('computes Heiken Ashi candles correctly', () => {
        const ha = computeHeikenAshi(mockCandles)
        expect(ha).toHaveLength(3)

        // First candle
        expect(ha[0].close).toBe((100 + 110 + 90 + 105) / 4)
        expect(ha[0].open).toBe((100 + 105) / 2)

        // Second candle
        const expectedPrevOpen = (100 + 105) / 2
        const expectedPrevClose = (100 + 110 + 90 + 105) / 4
        expect(ha[1].open).toBe((expectedPrevOpen + expectedPrevClose) / 2)
    })

    it('detects BULLISH trend correctly', () => {
        const ha = computeHeikenAshi(mockCandles)
        expect(detectHeikenAshiTrend(ha)).toBe('BULLISH')
    })

    it('detects BEARISH trend correctly', () => {
        const bearishCandles: Candle[] = [
            { ts: '1', open: 100, high: 110, low: 90, close: 95 },
            { ts: '2', open: 95, high: 100, low: 85, close: 90 },
            { ts: '3', open: 90, high: 95, low: 80, close: 85 },
        ]
        const ha = computeHeikenAshi(bearishCandles)
        expect(detectHeikenAshiTrend(ha)).toBe('BEARISH')
    })

    it('returns NEUTRAL for mixed or insufficient data', () => {
        expect(detectHeikenAshiTrend([])).toBe('NEUTRAL')
        expect(detectHeikenAshiTrend(computeHeikenAshi([mockCandles[0]]))).toBe('NEUTRAL')
    })
})
