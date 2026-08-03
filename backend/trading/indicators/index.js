/**
 * Centralized Mathematical Indicators Library for OptionAlgo Strategy Plugins
 */

/**
 * Exponential Moving Average (EMA)
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
 * Heiken Ashi Candle Construction
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
      time: c.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose
    });
  }
  return haCandles;
}

/**
 * Relative Strength Index (RSI)
 */
function computeRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return [];
  const rsi = new Array(values.length).fill(0);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return rsi;
}

/**
 * Volume Weighted Average Price (VWAP)
 */
function computeVWAP(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const vwap = [];
  let cumulativeTPV = 0;
  let cumulativeVol = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;

    cumulativeTPV += tp * vol;
    cumulativeVol += vol;
    vwap.push(cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : tp);
  }

  return vwap;
}

module.exports = {
  computeEMA,
  computeJMA,
  computeHeikenAshi,
  computeRSI,
  computeVWAP
};
