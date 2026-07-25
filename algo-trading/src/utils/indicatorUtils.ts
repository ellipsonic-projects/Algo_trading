import type { CandleItem, LineSeriesItem } from '../components/chart/TradingViewChart';

/**
 * Compute Exponential Moving Average (EMA) locally for visualization.
 */
export function computeLocalEMA(candles: CandleItem[], period: number = 20): LineSeriesItem[] {
  if (!candles || candles.length === 0 || period <= 0) return [];

  const result: LineSeriesItem[] = [];
  const k = 2 / (period + 1);

  let ema = 0;
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (i < period - 1) {
      sum += close;
    } else if (i === period - 1) {
      sum += close;
      ema = sum / period;
      result.push({ time: candles[i].time, value: Number(ema.toFixed(2)) });
    } else {
      ema = close * k + ema * (1 - k);
      result.push({ time: candles[i].time, value: Number(ema.toFixed(2)) });
    }
  }

  return result;
}

/**
 * Compute Jurik Moving Average (JMA) locally for visualization.
 */
export function computeLocalJMA(candles: CandleItem[], length: number = 7, phase: number = 0, power: number = 2): LineSeriesItem[] {
  if (!candles || candles.length === 0 || length <= 0) return [];

  const result: LineSeriesItem[] = [];
  const phaseParam = phase < -100 ? -0.5 : phase > 100 ? 0.5 : phase / 100 + 1.5;
  const beta = 0.45 * (length - 1) / (0.45 * (length - 1) + 2);

  let e0 = 0, e1 = 0, e2 = 0, jma = 0;

  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].close;
    if (i === 0) {
      e0 = price;
      e1 = 0;
      e2 = 0;
      jma = price;
    } else {
      e0 = (1 - beta) * price + beta * e0;
      e1 = (price - e0) * (1 - beta) + beta * e1;
      e2 = (e0 + phaseParam * e1 - jma) * Math.pow(1 - beta, power) + Math.pow(beta, power) * e2;
      jma = jma + e2;
    }

    if (i >= length - 1) {
      result.push({ time: candles[i].time, value: Number(jma.toFixed(2)) });
    }
  }

  return result;
}
