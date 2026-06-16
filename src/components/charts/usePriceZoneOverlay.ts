import { useEffect, useRef, type RefObject } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import {
  applyZoneVisual,
  createZoneElements,
  positionPriceZones,
  type OverlayZoneItem,
} from './chartLabelUtils'
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
      const overlay = overlayRef.current
      if (!series || !chart || !overlay || itemsRef.current.length === 0) return
      positionPriceZones(series, chart, overlay, itemsRef.current)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [chartRef, seriesRef, overlayRef])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    for (const it of itemsRef.current) {
      it.rectEl.remove()
      it.labelEl.remove()
    }
    itemsRef.current = []

    const created: OverlayZoneItem[] = []

    const emphasize = (target: OverlayZoneItem) => {
      for (const it of created) {
        applyZoneVisual(it, it === target ? 'emphasized' : 'dimmed')
      }
    }
    const reset = () => {
      for (const it of created) applyZoneVisual(it, 'default')
    }

    for (const zone of zones) {
      const { rectEl, labelEl } = createZoneElements(zone)
      const item: OverlayZoneItem = { zone, rectEl, labelEl }
      rectEl.addEventListener('mouseenter', () => emphasize(item))
      rectEl.addEventListener('mouseleave', reset)
      overlay.insertBefore(rectEl, overlay.firstChild)
      overlay.insertBefore(labelEl, overlay.firstChild)
      created.push(item)
    }
    itemsRef.current = created

    const series = seriesRef.current
    const chart = chartRef.current
    if (series && chart) positionPriceZones(series, chart, overlay, created)

    return () => {
      for (const it of itemsRef.current) {
        it.rectEl.remove()
        it.labelEl.remove()
      }
      itemsRef.current = []
    }
  }, [zones, layoutKey, chartRef, seriesRef, overlayRef])
}
