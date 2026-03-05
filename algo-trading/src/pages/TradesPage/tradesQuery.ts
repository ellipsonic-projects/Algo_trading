export type TradesFilters = {
  searchQuery?: string
  exitReasonFilter?: string
  strategyIdFilter?: string
  startDate?: string
  endDate?: string
  timeFrom?: string
  timeTo?: string
}

export function buildTradesUrl(params: {
  page: number
  limit: number
  filters: TradesFilters
}): string {
  const { page, limit, filters } = params

  let url = `/trades?page=${page}&limit=${limit}`

  if (filters.searchQuery) url += `&searchQuery=${encodeURIComponent(filters.searchQuery)}`
  if (filters.exitReasonFilter) url += `&exitReason=${encodeURIComponent(filters.exitReasonFilter)}`
  if (filters.strategyIdFilter) url += `&strategyId=${encodeURIComponent(filters.strategyIdFilter)}`
  if (filters.startDate) url += `&startDate=${filters.startDate}`
  if (filters.endDate) url += `&endDate=${filters.endDate}`
  if (filters.timeFrom) url += `&timeFrom=${encodeURIComponent(filters.timeFrom)}`
  if (filters.timeTo) url += `&timeTo=${encodeURIComponent(filters.timeTo)}`

  return url
}
