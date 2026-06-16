export interface PriceLineDef {
  price: number
  color: string
  title: string
  dashed?: boolean
  width?: 1 | 2 | 3
}

export interface ChartMarker {
  /** Must match a candle's `time` (seconds) or it is dropped silently. */
  time: number
  position: 'aboveBar' | 'belowBar' | 'inBar'
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  text?: string
}

export interface PriceZoneDef {
  priceLow: number
  priceHigh: number
  /** UNIX timestamp in seconds — zone left edge. */
  timeFrom: number
  /** UNIX timestamp in seconds — zone right edge. */
  timeTo: number
  side: 'support' | 'resistance'
  label: string
  subtitle?: string
  /** Level strength 0..1 — drives label text and zone opacity. */
  strength: number
}
