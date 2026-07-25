/**
 * Transforms standard OHLC candles into Heiken Ashi candles.
 */
function computeHeikenAshi(candles) {
    if (!Array.isArray(candles) || candles.length === 0) return [];

    const haCandles = [];

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const haClose = (c.open + c.high + c.low + c.close) / 4;

        let haOpen;
        if (i === 0) {
            haOpen = (c.open + c.close) / 2;
        } else {
            const prevHa = haCandles[i - 1];
            haOpen = (prevHa.open + prevHa.close) / 2;
        }

        const haHigh = Math.max(c.high, haOpen, haClose);
        const haLow = Math.min(c.low, haOpen, haClose);

        haCandles.push({
            ts: c.ts,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose,
        });
    }

    return haCandles;
}

/**
 * Exponential Moving Average
 */
function computeEMA(values, period) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const ema = [];
    const k = 2 / (period + 1);

    let currentEma = values[0];
    ema.push(currentEma);

    for (let i = 1; i < values.length; i++) {
        currentEma = (values[i] - currentEma) * k + currentEma;
        ema.push(currentEma);
    }
    return ema;
}

/**
 * Jurik Moving Average (JMA) Approximation
 */
function computeJMA(values, length, phase = 0) {
    if (!Array.isArray(values) || values.length === 0) return [];

    const jma = [];

    let e0 = 0, e1 = 0, e2 = 0, jma_prev = values[0];
    const beta = (0.45 * (length - 1)) / (0.45 * (length - 1) + 2);
    const alpha = Math.pow(beta, 1.5);

    const phase_ratio = phase < -100 ? 0.5 : phase > 100 ? 2.5 : (phase / 100) + 1.5;

    for (let i = 0; i < values.length; i++) {
        const val = values[i];

        e0 = (1 - alpha) * val + alpha * e0;
        e1 = (val - e0) * (1 - beta) + beta * e1;
        e2 = (e0 + phase_ratio * e1 - jma_prev) * Math.pow(1 - alpha, 2) + Math.pow(alpha, 2) * e2;

        const currentJma = jma_prev + e2;
        jma.push(currentJma);
        jma_prev = currentJma;
    }

    return jma;
}

/**
 * Analyze Heiken Ashi Strategy Signals
 */
function analyzeHeikenAshiStrategy(haCandles, emaPeriod = 20, jmaLength = 7) {
    if (!Array.isArray(haCandles) || haCandles.length < 2) {
        return { trend: 'NEUTRAL', ema: 0, jma: 0, haClose: 0, isEntry: false, isExit: false };
    }

    const closes = haCandles.map(c => c.close);
    const emas = computeEMA(closes, emaPeriod);
    const jmas = computeJMA(closes, jmaLength);

    const lastClosedIdx = haCandles.length - 2;
    const prevClosedIdx = haCandles.length - 3;

    if (lastClosedIdx < 0 || prevClosedIdx < 0) {
        return { trend: 'NEUTRAL', ema: 0, jma: 0, haClose: 0, isEntry: false, isExit: false };
    }

    const last = haCandles[lastClosedIdx];
    const prev = haCandles[prevClosedIdx];
    const lastEma = emas[lastClosedIdx];
    const lastJma = jmas[lastClosedIdx];

    const lastNoWick = Math.abs(last.open - last.low) <= 0.05;
    const prevNoWick = Math.abs(prev.open - prev.low) <= 0.05;

    const isEntry = (
        lastNoWick && prevNoWick &&
        last.close > last.open &&
        prev.close > prev.open &&
        lastJma > lastEma &&
        last.close > lastJma
    );

    const isExit = (
        last.close < last.open &&
        prev.close < prev.open
    );

    let trend = 'NEUTRAL';
    if (isEntry) trend = 'BULLISH';
    else if (isExit) trend = 'BEARISH';

    return {
        trend,
        ema: lastEma,
        jma: lastJma,
        haClose: last.close,
        isEntry,
        isExit
    };
}

function detectHeikenAshiTrend(haCandles) {
    if (!Array.isArray(haCandles) || haCandles.length < 2) return 'NEUTRAL';

    const last = haCandles[haCandles.length - 1];
    const prev = haCandles[haCandles.length - 2];

    if (last.close > last.open && prev.close > prev.open) {
        return 'BULLISH';
    }

    if (last.close < last.open && prev.close < prev.open) {
        return 'BEARISH';
    }

    return 'NEUTRAL';
}

module.exports = {
    computeHeikenAshi,
    computeEMA,
    computeJMA,
    analyzeHeikenAshiStrategy,
    detectHeikenAshiTrend
};
