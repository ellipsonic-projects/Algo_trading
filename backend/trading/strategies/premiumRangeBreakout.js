function computePremiumRange(candles, lookback = 5, maxRangeLimit = 30) {
  if (!Array.isArray(candles) || candles.length < lookback) return null;

  const slice = candles.slice(-lookback);
  const mother = slice[0];
  if (!mother || !Number.isFinite(mother.high) || !Number.isFinite(mother.low)) return null;

  const rangeHigh = mother.high;
  const rangeLow = mother.low;
  if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow)) return null;

  let insideRuleOk = true;
  for (let i = 1; i < slice.length; i += 1) {
    const c = slice[i];
    if (!c || !Number.isFinite(c.open) || !Number.isFinite(c.close)) {
      insideRuleOk = false;
      break;
    }
    if (c.open < rangeLow || c.open > rangeHigh) {
      insideRuleOk = false;
      break;
    }
    if (c.close < rangeLow || c.close > rangeHigh) {
      insideRuleOk = false;
      break;
    }
  }

  const size = rangeHigh - rangeLow;
  return {
    rangeHigh,
    rangeLow,
    size,
    isValid: insideRuleOk && Number.isFinite(size) && size <= maxRangeLimit,
  };
}

function detectBreakoutCloseOnly(params) {
  const { candleClose, range } = params || {};
  if (!Number.isFinite(candleClose)) return false;
  if (!range || !range.isValid) return false;

  return candleClose > range.rangeHigh;
}

function computeStopLossAndTarget(params) {
  const { entryPrice, rangeLow } = params || {};
  if (!Number.isFinite(entryPrice) || !Number.isFinite(rangeLow)) return null;

  const stopLoss = rangeLow - 2;
  const riskPoints = entryPrice - stopLoss;
  if (!Number.isFinite(riskPoints) || riskPoints < 10) return null;
  const target = entryPrice + riskPoints;

  return { stopLoss, target };
}

function shouldProcessCandle(params) {
  const { lastProcessedTs, nextTs } = params || {};
  const n = String(nextTs || '').trim();
  if (!n) return false;
  if (lastProcessedTs === null) return true;
  return n !== lastProcessedTs;
}

module.exports = {
  computePremiumRange,
  detectBreakoutCloseOnly,
  computeStopLossAndTarget,
  shouldProcessCandle
};
