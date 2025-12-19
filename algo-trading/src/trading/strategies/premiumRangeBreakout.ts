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

export function computePremiumRange(candles: Candle[], lookback: 4 | 5): RangeSnapshot | null {
  if (!Array.isArray(candles) || candles.length < lookback) return null

  const slice = candles.slice(-lookback)
  let rangeHigh = Number.NEGATIVE_INFINITY
  let rangeLow = Number.POSITIVE_INFINITY

  for (const c of slice) {
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) return null
    rangeHigh = Math.max(rangeHigh, c.high)
    rangeLow = Math.min(rangeLow, c.low)
  }

  if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow)) return null

  const size = rangeHigh - rangeLow
  return {
    rangeHigh,
    rangeLow,
    size,
    isValid: Number.isFinite(size) && size <= 30,
  }
}

export function detectBreakoutCloseOnly(params: {
  candleClose: number
  range: RangeSnapshot
}): BreakoutSide | null {
  const { candleClose, range } = params
  if (!Number.isFinite(candleClose)) return null
  if (!range.isValid) return null

  if (candleClose > range.rangeHigh) return 'CE'
  if (candleClose < range.rangeLow) return 'PE'
  return null
}

export function computeStopLossAndTarget(params: {
  entryPrice: number
  rangeLow: number
}): { stopLoss: number; target: number } | null {
  const { entryPrice, rangeLow } = params
  if (!Number.isFinite(entryPrice) || !Number.isFinite(rangeLow)) return null

  const rawSL = rangeLow - 2
  const maxDistanceSL = entryPrice - 35
  const stopLoss = Math.max(maxDistanceSL, rawSL)
  const riskPoints = entryPrice - stopLoss
  if (!Number.isFinite(riskPoints) || riskPoints <= 0) return null
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
