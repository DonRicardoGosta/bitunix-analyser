import { useEffect, useRef, type RefObject } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import { createZoneElements, positionPriceZones, type OverlayZoneItem } from './chartLabelUtils'
import type { PriceZoneDef } from './chartTypes'

interface UsePriceZoneOverlayArgs {
  chartRef: RefObject<IChartApi | null>
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>
  overlayRef: RefObject<HTMLDivElement | null>
  zones: PriceZoneDef[]
  layoutKey?: unknown
}

/** HTML overlay support/resistance zones (semi-transparent rectangles + labels). */
export function usePriceZoneOverlay({
  chartRef,
  seriesRef,
  overlayRef,
  zones,
  layoutKey,
}: UsePriceZoneOverlayArgs): void {
  const itemsRef = useRef<OverlayZoneItem[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const series = seriesRef.current
      const chart = chartRef.current
      if (!series || !chart || itemsRef.current.length === 0) return
      positionPriceZones(series, chart, itemsRef.current)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [chartRef, seriesRef])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    for (const it of itemsRef.current) {
      it.rectEl.remove()
      it.labelEl.remove()
    }
    itemsRef.current = []

    const created: OverlayZoneItem[] = []
    for (const zone of zones) {
      const { rectEl, labelEl } = createZoneElements(zone)
      overlay.insertBefore(rectEl, overlay.firstChild)
      overlay.insertBefore(labelEl, overlay.firstChild)
      created.push({ zone, rectEl, labelEl })
    }
    itemsRef.current = created

    const series = seriesRef.current
    const chart = chartRef.current
    if (series && chart) positionPriceZones(series, chart, created)

    return () => {
      for (const it of itemsRef.current) {
        it.rectEl.remove()
        it.labelEl.remove()
      }
      itemsRef.current = []
    }
  }, [zones, layoutKey, chartRef, seriesRef, overlayRef])
}
