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

/**
 * Exponential Moving Average
 */
export function computeEMA(values: number[], period: number): number[] {
    if (values.length === 0) return []
    const ema: number[] = []
    const k = 2 / (period + 1)

    let currentEma = values[0]
    ema.push(currentEma)

    for (let i = 1; i < values.length; i++) {
        currentEma = (values[i] - currentEma) * k + currentEma
        ema.push(currentEma)
    }
    return ema
}

/**
 * Jurik Moving Average (JMA) Approximation
 * Reverse-engineered version commonly used in Pine Script.
 */
export function computeJMA(values: number[], length: number, phase: number = 0): number[] {
    if (values.length === 0) return []

    const jma: number[] = []

    // Internal state buffers
    let e0 = 0, e1 = 0, e2 = 0, jma_prev = values[0]
    const beta = 0.45 * (length - 1) / (0.45 * (length - 1) + 2)
    const alpha = Math.pow(beta, 1.5)

    const phase_ratio = phase < -100 ? 0.5 : phase > 100 ? 2.5 : (phase / 100) + 1.5

    for (let i = 0; i < values.length; i++) {
        const val = values[i]

        // This is a simplified version of the JMA adaptive filter
        // High fidelity JMA requires more complex internal state management
        // but for a 7-period JMA, standard smoothing is often the goal.

        // Stage 1: Preliminary smoothing
        e0 = (1 - alpha) * val + alpha * e0
        e1 = (val - e0) * (1 - beta) + beta * e1
        e2 = (e0 + phase_ratio * e1 - jma_prev) * Math.pow(1 - alpha, 2) + Math.pow(alpha, 2) * e2

        const currentJma = jma_prev + e2
        jma.push(currentJma)
        jma_prev = currentJma
    }

    return jma
}

export type HeikenAshiTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export type StrategySignal = {
    trend: HeikenAshiTrend
    ema: number
    jma: number
    haClose: number
    isEntry: boolean
    isExit: boolean
}

/**
 * Strategy Rules Implementation:
 * 
 * Entry (Bullish):
 * 1. Two consecutive HA candles with no lower wick (Open = Low).
 * 2. JMA 7 > EMA 20.
 * 3. Close of 2nd HA candle > JMA 7.
 * 
 * Exit (Bullish):
 * 1. Two consecutive red HA candles (Close < Open).
 */
export function analyzeHeikenAshiStrategy(
    haCandles: HeikenAshiCandle[],
    emaPeriod: number = 20,
    jmaLength: number = 7
): StrategySignal {
    if (haCandles.length < 2) {
        return { trend: 'NEUTRAL', ema: 0, jma: 0, haClose: 0, isEntry: false, isExit: false }
    }

    const closes = haCandles.map(c => c.close)
    const emas = computeEMA(closes, emaPeriod)
    const jmas = computeJMA(closes, jmaLength)

    const lastIdx = haCandles.length - 1
    const prevIdx = lastIdx - 1

    const last = haCandles[lastIdx]
    const prev = haCandles[prevIdx]
    const lastEma = emas[lastIdx]
    const lastJma = jmas[lastIdx]

    // Entry Conditions check (Allowing very tiny wick up to 5% of body size or fixed absolute small value)
    const lastBody = Math.abs(last.close - last.open)
    const prevBody = Math.abs(prev.close - prev.open)

    // An ideal HA entry candle has 0 lower wick. However, float math or very slight 
    // real-market ticks can cause a visible "no wick" to actually have ~0.5 points.
    // We allow a lower wick if it's <= 2% of the body, OR absolutely <= 0.5 points.
    const lastWick = last.open - last.low
    const prevWick = prev.open - prev.low

    const lastNoWick = lastWick <= 0.5 || lastWick <= lastBody * 0.02
    const prevNoWick = prevWick <= 0.5 || prevWick <= prevBody * 0.02

    const isEntry = (
        lastNoWick && prevNoWick &&     // 2 consecutive no lower wick
        last.close > last.open &&       // Green candles
        prev.close > prev.open &&
        lastJma > lastEma &&            // JMA 7 > EMA 20
        last.close > lastJma            // Close > JMA 7
    )

    // Exit Conditions check
    const isExit = (
        last.close < last.open &&       // 2 consecutive red candles
        prev.close < prev.open
    )

    let trend: HeikenAshiTrend = 'NEUTRAL'
    if (isEntry) trend = 'BULLISH'
    else if (isExit) trend = 'BEARISH'

    return {
        trend,
        ema: lastEma,
        jma: lastJma,
        haClose: last.close,
        isEntry,
        isExit
    }
}
