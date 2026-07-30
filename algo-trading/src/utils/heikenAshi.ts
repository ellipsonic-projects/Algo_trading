export type CandleItem = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
  Transforms standard OHLC candles into smoothed Heiken Ashi candles.
 */
export function transformToHeikenAshi(candles: CandleItem[]): CandleItem[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  const haCandles: CandleItem[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;

    let haOpen: number;
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
      open: Number(haOpen.toFixed(2)),
      high: Number(haHigh.toFixed(2)),
      low: Number(haLow.toFixed(2)),
      close: Number(haClose.toFixed(2)),
    });
  }

  return haCandles;
}
