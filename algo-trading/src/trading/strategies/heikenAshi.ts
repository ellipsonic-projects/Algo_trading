import type { Candle } from './premiumRangeBreakout'

export type HeikenAshiCandle = {
    ts: string
    open: number
    high: number
    low: number
    close: number
}

/**
 * Transforms standard OHLC candles into Heiken Ashi candles.
 * HA Close = (Open + High + Low + Close) / 4
 * HA Open = (Previous HA Open + Previous HA Close) / 2
 * HA High = Max(High, HA Open, HA Close)
 * HA Low = Min(Low, HA Open, HA Close)
 */
export function computeHeikenAshi(candles: Candle[]): HeikenAshiCandle[] {
    if (candles.length === 0) return []

    const haCandles: HeikenAshiCandle[] = []

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i]
        const haClose = (c.open + c.high + c.low + c.close) / 4

        let haOpen: number
        if (i === 0) {
            haOpen = (c.open + c.close) / 2
        } else {
            const prevHa = haCandles[i - 1]
            haOpen = (prevHa.open + prevHa.close) / 2
        }

        const haHigh = Math.max(c.high, haOpen, haClose)
        const haLow = Math.min(c.low, haOpen, haClose)

        haCandles.push({
            ts: c.ts,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose,
        })
    }

    return haCandles
}

export type HeikenAshiTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

/**
 * Detects trend based on Heiken Ashi candles.
 * BULLISH: Two consecutive green candles (Close > Open)
 * BEARISH: Two consecutive red candles (Close < Open)
 */
export function detectHeikenAshiTrend(haCandles: HeikenAshiCandle[]): HeikenAshiTrend {
    if (haCandles.length < 2) return 'NEUTRAL'

    const last = haCandles[haCandles.length - 1]
    const prev = haCandles[haCandles.length - 2]

    if (last.close > last.open && prev.close > prev.open) {
        return 'BULLISH'
    }

    if (last.close < last.open && prev.close < prev.open) {
        return 'BEARISH'
    }

    return 'NEUTRAL'
}
