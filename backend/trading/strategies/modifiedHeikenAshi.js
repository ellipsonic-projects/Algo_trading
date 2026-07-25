const { computeEMA, computeJMA } = require('./heikenAshi');

function computeModifiedHeikenAshi(candles) {
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

function analyzeModifiedHeikenAshiStrategy(haCandles, emaPeriod = 20, jmaLength = 7) {
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

module.exports = {
    computeModifiedHeikenAshi,
    analyzeModifiedHeikenAshiStrategy
};
