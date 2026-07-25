const { computeEMA, computeJMA, computeHeikenAshi } = require('../trading/strategies/heikenAshi');
const { computeModifiedHeikenAshi } = require('../trading/strategies/modifiedHeikenAshi');

function computeChartIndicators(candles, emaPeriod = 20, jmaPeriod = 7) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { ema: [], jma: [], modifiedHa: [] };
  }

  const closes = candles.map((c) => c.close);
  const emaValues = computeEMA(closes, emaPeriod);
  const jmaValues = computeJMA(closes, jmaPeriod);
  const mhaCandles = computeModifiedHeikenAshi(candles);

  const emaSeries = candles.map((c, i) => ({
    time: c.time,
    value: Number(emaValues[i].toFixed(2)),
  }));

  const jmaSeries = candles.map((c, i) => ({
    time: c.time,
    value: Number(jmaValues[i].toFixed(2)),
  }));

  const modifiedHaSeries = mhaCandles.map((c) => ({
    time: c.time,
    open: Number(c.open.toFixed(2)),
    high: Number(c.high.toFixed(2)),
    low: Number(c.low.toFixed(2)),
    close: Number(c.close.toFixed(2)),
  }));

  return {
    ema: emaSeries,
    jma: jmaSeries,
    modifiedHa: modifiedHaSeries,
  };
}

module.exports = {
  computeChartIndicators,
};
