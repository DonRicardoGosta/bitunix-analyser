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
