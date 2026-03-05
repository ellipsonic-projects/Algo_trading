export type Candle = {
  ts: string
  open: number
  high: number
  low: number
  close: number
}

export type RangeSnapshot = {
  rangeHigh: number
  rangeLow: number
  size: number
  isValid: boolean
}

export type BreakoutSide = 'CE' | 'PE'

export function computePremiumRange(candles: Candle[], lookback: 4 | 5, maxRangeLimit: number = 30): RangeSnapshot | null {
  if (!Array.isArray(candles) || candles.length < lookback) return null

  const slice = candles.slice(-lookback)
  const mother = slice[0]
  if (!Number.isFinite(mother?.high) || !Number.isFinite(mother?.low)) return null

  const rangeHigh = mother.high
  const rangeLow = mother.low
  if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow)) return null

  let insideRuleOk = true
  for (let i = 1; i < slice.length; i += 1) {
    const c = slice[i]
    if (!Number.isFinite(c.open) || !Number.isFinite(c.close)) {
      insideRuleOk = false
      break
    }
    if (c.open < rangeLow || c.open > rangeHigh) {
      insideRuleOk = false
      break
    }
    if (c.close < rangeLow || c.close > rangeHigh) {
      insideRuleOk = false
      break
    }
  }

  const size = rangeHigh - rangeLow
  return {
    rangeHigh,
    rangeLow,
    size,
    isValid: insideRuleOk && Number.isFinite(size) && size <= maxRangeLimit,
  }
}

export function detectBreakoutCloseOnly(params: { candleClose: number; range: RangeSnapshot }): boolean {
  const { candleClose, range } = params
  if (!Number.isFinite(candleClose)) return false
  if (!range.isValid) return false

  return candleClose > range.rangeHigh
}

export function computeStopLossAndTarget(params: {
  entryPrice: number
  rangeLow: number
}): { stopLoss: number; target: number } | null {
  const { entryPrice, rangeLow } = params
  if (!Number.isFinite(entryPrice) || !Number.isFinite(rangeLow)) return null

  const stopLoss = rangeLow - 2
  const riskPoints = entryPrice - stopLoss
  if (!Number.isFinite(riskPoints) || riskPoints < 10) return null
  const target = entryPrice + riskPoints

  return { stopLoss, target }
}

export function shouldProcessCandle(params: { lastProcessedTs: string | null; nextTs: string }): boolean {
  const { lastProcessedTs, nextTs } = params
  const n = String(nextTs || '').trim()
  if (!n) return false
  if (lastProcessedTs === null) return true
  return n !== lastProcessedTs
}
