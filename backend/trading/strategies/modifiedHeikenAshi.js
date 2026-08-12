const { computeHeikenAshi: computeModifiedHeikenAshi, computeEMA, computeJMA } = require('../indicators');
const strategyStats = require('../../services/strategyStats');


function analyzeModifiedHeikenAshiStrategy(haCandles, emaPeriod = 20, jmaLength = 7) {
    if (!Array.isArray(haCandles) || haCandles.length < 2) {
        return { trend: 'NEUTRAL', ema: 0, jma: 0, haClose: 0, isEntry: false, isExit: false };
    }

    const closes = haCandles.map(c => c.close);
    const emas = computeEMA(closes, emaPeriod);
    const jmas = computeJMA(closes, jmaLength);

    const lastClosedIdx = haCandles.length - 1;
    const prevClosedIdx = haCandles.length - 2;

    if (lastClosedIdx < 0 || prevClosedIdx < 0) {
        return { trend: 'NEUTRAL', ema: 0, jma: 0, haClose: 0, isEntry: false, isExit: false };
    }

    const last = haCandles[lastClosedIdx];
    const prev = haCandles[prevClosedIdx];
    const lastEma = emas[lastClosedIdx];
    const lastJma = jmas[lastClosedIdx];

    const lastNoWick = Math.abs(last.open - last.low) <= 0.05;
    const prevNoWick = Math.abs(prev.open - prev.low) <= 0.05;
    const lastGreen = last.close > last.open;
    const prevGreen = prev.close > prev.open;
    const jmaGtEma = lastJma > lastEma;
    const closeGtJma = last.close > lastJma;

    const isEntry = (
        lastNoWick && prevNoWick &&
        lastGreen &&
        prevGreen &&
        jmaGtEma &&
        closeGtJma
    );

    const failedReasons = [];
    if (!lastNoWick) failedReasons.push(`lastNoWick = false (open - low = ${Math.abs(last.open - last.low).toFixed(4)}, required <= 0.05)`);
    if (!prevNoWick) failedReasons.push(`prevNoWick = false (open - low = ${Math.abs(prev.open - prev.low).toFixed(4)}, required <= 0.05)`);
    if (!lastGreen) failedReasons.push(`lastGreen = false (close = ${last.close.toFixed(2)}, open = ${last.open.toFixed(2)})`);
    if (!prevGreen) failedReasons.push(`prevGreen = false (close = ${prev.close.toFixed(2)}, open = ${prev.open.toFixed(2)})`);
    if (!jmaGtEma) failedReasons.push(`jmaGtEma = false (JMA = ${lastJma.toFixed(2)}, EMA = ${lastEma.toFixed(2)})`);
    if (!closeGtJma) failedReasons.push(`closeGtJma = false (close = ${last.close.toFixed(2)}, JMA = ${lastJma.toFixed(2)})`);

    const isExit = (
        last.close < last.open &&
        prev.close < prev.open
    );

    let trend = 'NEUTRAL';
    if (isEntry) trend = 'BULLISH';
    else if (isExit) trend = 'BEARISH';

    const result = {
        trend,
        ema: lastEma,
        jma: lastJma,
        haClose: last.close,
        isEntry,
        isExit,
        lastNoWick,
        prevNoWick,
        lastGreen,
        prevGreen,
        jmaGtEma,
        closeGtJma,
        failedReasons,
        lastCandle: last,
        prevCandle: prev
    };

    // ── Diagnostic statistics collection (no logic impact) ──────────────────
    strategyStats.record(result, 'ModifiedHeikenAshi');

    return result;
}

module.exports = {
    computeModifiedHeikenAshi,
    analyzeModifiedHeikenAshiStrategy
};
