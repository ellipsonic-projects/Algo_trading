export type Side = 'BUY' | 'SELL'
export type Product = 'DELIVERY' | 'INTRADAY'
export type ExitProduct = Product | 'CARRYFORWARD'

export type PositionProductFields = {
  producttype?: string
  productType?: string
  product?: string
  posType?: string
}

export function getPositionExitProductType(p: PositionProductFields): ExitProduct | null {
  const raw = String(p.producttype ?? p.productType ?? p.product ?? p.posType ?? '')
    .trim()
    .toUpperCase()

  if (!raw) return null
  if (raw === 'DELIVERY' || raw === 'CNC') return 'DELIVERY'
  if (raw === 'INTRADAY' || raw === 'MIS') return 'INTRADAY'
  if (raw === 'CARRYFORWARD' || raw === 'NRML') return 'CARRYFORWARD'
  return null
}

export function coerceProductForSide(nextSide: Side, currentProduct: Product): Product {
  if (nextSide === 'SELL') return 'INTRADAY'
  return currentProduct
}
