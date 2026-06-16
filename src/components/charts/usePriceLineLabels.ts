import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi } from 'lightweight-charts'
import { dimColor, positionOverlayLabels, solidColor } from './chartLabelUtils'
import type { PriceLineDef, PriceLineDragMeta } from './chartTypes'
import { roundToPrecision } from '../../features/analysis/setup/order'
import { positionPnlAt, validateTpslTriggerPrice } from '../../features/stats/positions'
import { fmtPrice, fmtSignedUsd } from '../../lib/format'

interface ChartLabel {
  price: number
  color: string
  baseWidth: 1 | 2 | 3
  baseStyle: LineStyle
  line: IPriceLine
  el: HTMLDivElement
  titleEl: HTMLDivElement
  subtitleEl: HTMLDivElement | null
  titleText: string
  draggable?: PriceLineDragMeta
}

interface DragState {
  item: ChartLabel
  fromPrice: number
  borderColor: string
}

interface UsePriceLineLabelsArgs {
  chartRef: RefObject<IChartApi | null>
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>
  overlayRef: RefObject<HTMLDivElement | null>
  lines: PriceLineDef[]
  /** Re-sync labels when candle data changes (price scale / autoscale). */
  layoutKey?: unknown
  onTpslDragEnd?: (payload: {
    meta: PriceLineDragMeta
    fromPrice: number
    toPrice: number
  }) => void
  quotePrecision?: number
  /** Keep label pinned to its price line while confirm modal is open. */
  pinnedTpslOrderId?: string | null
  pinnedTpslKind?: 'tp' | 'sl' | null
}

function lineKey(def: PriceLineDef): string {
  if (def.draggable) return `${def.draggable.orderId}:${def.draggable.kind}`
  return def.title
}

function itemKey(item: ChartLabel): string {
  if (item.draggable) return `${item.draggable.orderId}:${item.draggable.kind}`
  return item.titleText
}

function validLineDefs(lines: PriceLineDef[]): PriceLineDef[] {
  return lines.filter((d) => Number.isFinite(d.price) && d.price > 0)
}

function createLabelElement(def: PriceLineDef): {
  el: HTMLDivElement
  titleEl: HTMLDivElement
  subtitleEl: HTMLDivElement | null
} {
  const solid = solidColor(def.color)
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'absolute',
    top: '-9999px',
    right: '0px',
    transform: 'translateY(-50%)',
    font: '600 11px Inter, sans-serif',
    lineHeight: '16px',
    color: solid,
    background: '#0b0f18',
    border: `1px solid ${solid}`,
    borderLeft: `3px solid ${solid}`,
    borderRadius: '4px',
    padding: '1px 6px',
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 3px rgba(0,0,0,0.7)',
    cursor: def.draggable ? 'ns-resize' : 'pointer',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>)
  const titleEl = document.createElement('div')
  titleEl.textContent = `${def.title} ${fmtPrice(def.price)}`
  el.appendChild(titleEl)
  let subtitleEl: HTMLDivElement | null = null
  if (def.subtitle) {
    subtitleEl = document.createElement('div')
    subtitleEl.textContent = def.subtitle
    subtitleEl.style.cssText = `
      margin-top: 1px;
      font: 500 9px Inter, sans-serif;
      letter-spacing: normal;
      color: rgba(148,163,184,0.9);
    `
    el.appendChild(subtitleEl)
  }
  return { el, titleEl, subtitleEl }
}

function updateLabelPrice(item: ChartLabel, price: number, subtitle?: string): void {
  item.price = price
  item.titleEl.textContent = `${item.titleText} ${fmtPrice(price)}`
  if (item.subtitleEl && subtitle !== undefined) {
    item.subtitleEl.textContent = subtitle
  }
  item.line.applyOptions({ price })
}

function syncItemFromDef(item: ChartLabel, def: PriceLineDef): void {
  item.color = def.color
  item.baseWidth = def.width ?? 1
  item.baseStyle = def.dashed ? LineStyle.Dashed : LineStyle.Solid
  item.titleText = def.title
  item.draggable = def.draggable
  updateLabelPrice(item, def.price, def.subtitle)
  item.line.applyOptions({
    color: def.color,
    lineWidth: item.baseWidth,
    lineStyle: item.baseStyle,
  })
  item.el.style.borderColor = solidColor(def.color)
  item.el.style.borderLeftColor = solidColor(def.color)
}

function structureMatches(items: ChartLabel[], defs: PriceLineDef[]): boolean {
  const valid = validLineDefs(defs)
  if (items.length !== valid.length) return false
  const itemKeys = items.map(itemKey).sort()
  const defKeys = valid.map(lineKey).sort()
  return itemKeys.every((k, i) => k === defKeys[i])
}

/**
 * HTML overlay price-line labels with collision avoidance and hover emphasis.
 * Used by SetupChart and CandlesChart instead of native axis labels.
 */
export function usePriceLineLabels({
  chartRef,
  seriesRef,
  overlayRef,
  lines,
  onTpslDragEnd,
  quotePrecision,
  pinnedTpslOrderId,
  pinnedTpslKind,
}: UsePriceLineLabelsArgs): void {
  const itemsRef = useRef<ChartLabel[]>([])
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const linesRef = useRef(lines)
  const onDragEndRef = useRef(onTpslDragEnd)
  const quotePrecisionRef = useRef(quotePrecision)
  const pinnedOrderIdRef = useRef(pinnedTpslOrderId)
  const pinnedKindRef = useRef(pinnedTpslKind)
  const syncRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    linesRef.current = lines
  }, [lines])

  useEffect(() => {
    onDragEndRef.current = onTpslDragEnd
  }, [onTpslDragEnd])

  useEffect(() => {
    quotePrecisionRef.current = quotePrecision
  }, [quotePrecision])

  useEffect(() => {
    pinnedOrderIdRef.current = pinnedTpslOrderId
    pinnedKindRef.current = pinnedTpslKind
  }, [pinnedTpslOrderId, pinnedTpslKind])

  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const series = seriesRef.current
      const chart = chartRef.current
      const overlay = overlayRef.current
      if (!series || !chart || !overlay) return

      const drag = dragRef.current
      const pinnedOrderId = pinnedOrderIdRef.current
      const pinnedKind = pinnedKindRef.current

      positionOverlayLabels(
        series,
        chart,
        overlay,
        itemsRef.current.map((l) => ({
          price: l.price,
          el: l.el,
          pinToPrice:
            l === drag?.item ||
            (!!pinnedOrderId &&
              !!pinnedKind &&
              l.draggable?.orderId === pinnedOrderId &&
              l.draggable.kind === pinnedKind),
        })),
      )
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [chartRef, seriesRef, overlayRef])

  useEffect(() => {
    const series = seriesRef.current
    const overlay = overlayRef.current
    if (!series || !overlay) return

    let onMouseMove: ((e: MouseEvent) => void) | null = null
    let onMouseUp: (() => void) | null = null

    const emphasize = (target: ChartLabel) => {
      if (dragRef.current) return
      for (const it of itemsRef.current) {
        if (it === target) {
          it.line.applyOptions({ color: solidColor(it.color), lineWidth: 3, lineStyle: LineStyle.Solid })
          it.el.style.opacity = '1'
          it.el.style.zIndex = '30'
          it.el.style.borderColor = solidColor(it.color)
          it.el.style.boxShadow = `0 0 0 1px ${solidColor(it.color)}, 0 2px 6px rgba(0,0,0,0.8)`
        } else {
          it.line.applyOptions({ color: dimColor(it.color, 0.12) })
          it.el.style.opacity = '0.28'
        }
      }
    }

    const reset = () => {
      if (dragRef.current) return
      for (const it of itemsRef.current) {
        it.line.applyOptions({ color: it.color, lineWidth: it.baseWidth, lineStyle: it.baseStyle })
        it.el.style.opacity = ''
        it.el.style.zIndex = ''
        it.el.style.borderColor = solidColor(it.color)
        it.el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.7)'
      }
    }

    const applyLinesUpdate = (skipItem?: ChartLabel): boolean => {
      const defs = validLineDefs(linesRef.current)
      const items = itemsRef.current
      if (items.length === 0 || !structureMatches(items, linesRef.current)) return false

      const byKey = new Map(items.map((it) => [itemKey(it), it]))
      for (const def of defs) {
        const item = byKey.get(lineKey(def))
        if (!item || item === skipItem) continue
        syncItemFromDef(item, def)
      }
      return true
    }

    const teardown = () => {
      if (onMouseMove) window.removeEventListener('mousemove', onMouseMove)
      if (onMouseUp) window.removeEventListener('mouseup', onMouseUp)
      onMouseMove = null
      onMouseUp = null
      for (const it of itemsRef.current) {
        series.removePriceLine(it.line)
        it.el.remove()
      }
      itemsRef.current = []
    }

    const catchUpAfterDrag = () => {
      if (!applyLinesUpdate()) syncRef.current?.()
    }

    const endDrag = (commit: boolean) => {
      const drag = dragRef.current
      if (!drag) return

      const { item, fromPrice, borderColor } = drag
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      const meta = item.draggable
      if (!meta) {
        catchUpAfterDrag()
        return
      }

      const toPrice = item.price
      const validationError = validateTpslTriggerPrice(meta.side, meta.kind, toPrice, meta.entry)
      const changed = Math.abs(toPrice - fromPrice) > 1e-12

      if (!commit || validationError || !changed) {
        const pnl = positionPnlAt(meta.side, meta.entry, fromPrice, meta.qty)
        updateLabelPrice(
          item,
          fromPrice,
          Number.isFinite(pnl) ? fmtSignedUsd(pnl) : undefined,
        )
        item.el.style.borderColor = borderColor
        item.el.style.borderLeftColor = borderColor
        catchUpAfterDrag()
        return
      }

      onDragEndRef.current?.({ meta, fromPrice, toPrice })
    }

    onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      const s = seriesRef.current
      if (!drag || !s) return

      const rect = overlay.getBoundingClientRect()
      const y = e.clientY - rect.top
      let price = s.coordinateToPrice(y) as number | null
      if (price === null || !Number.isFinite(price)) return

      const precision = quotePrecisionRef.current
      if (precision !== undefined) {
        price = roundToPrecision(price, precision)
      }

      const meta = drag.item.draggable!
      const validationError = validateTpslTriggerPrice(meta.side, meta.kind, price, meta.entry)
      const pnl = positionPnlAt(meta.side, meta.entry, price, meta.qty)
      updateLabelPrice(
        drag.item,
        price,
        Number.isFinite(pnl) ? fmtSignedUsd(pnl) : undefined,
      )

      const solid = solidColor(drag.item.color)
      if (validationError) {
        drag.item.el.style.borderColor = '#f43f5e'
        drag.item.el.style.borderLeftColor = '#f43f5e'
      } else {
        drag.item.el.style.borderColor = solid
        drag.item.el.style.borderLeftColor = solid
      }
    }

    onMouseUp = () => {
      if (onMouseMove) window.removeEventListener('mousemove', onMouseMove)
      if (onMouseUp) window.removeEventListener('mouseup', onMouseUp)
      endDrag(true)
      reset()
    }

    const fullRebuild = () => {
      teardown()

      for (const def of validLineDefs(linesRef.current)) {
        const baseWidth = def.width ?? 1
        const baseStyle = def.dashed ? LineStyle.Dashed : LineStyle.Solid
        const line = series.createPriceLine({
          price: def.price,
          color: def.color,
          lineWidth: baseWidth,
          lineStyle: baseStyle,
          axisLabelVisible: false,
        })
        const { el, titleEl, subtitleEl } = createLabelElement(def)
        const item: ChartLabel = {
          price: def.price,
          color: def.color,
          baseWidth,
          baseStyle,
          line,
          el,
          titleEl,
          subtitleEl,
          titleText: def.title,
          draggable: def.draggable,
        }
        el.addEventListener('mouseenter', () => emphasize(item))
        el.addEventListener('mouseleave', reset)

        if (def.draggable && onTpslDragEnd) {
          el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()

            const borderColor = solidColor(item.color)
            dragRef.current = { item, fromPrice: item.price, borderColor }
            document.body.style.cursor = 'ns-resize'
            document.body.style.userSelect = 'none'

            item.line.applyOptions({
              color: solidColor(item.color),
              lineWidth: 3,
              lineStyle: LineStyle.Solid,
            })
            item.el.style.opacity = '1'
            item.el.style.zIndex = '30'

            if (onMouseMove) window.addEventListener('mousemove', onMouseMove)
            if (onMouseUp) window.addEventListener('mouseup', onMouseUp)
          })
        }

        overlay.appendChild(el)
        itemsRef.current.push(item)
      }
    }

    syncRef.current = fullRebuild

    if (dragRef.current) {
      applyLinesUpdate(dragRef.current.item)
      return () => {
        if (dragRef.current) return
        teardown()
      }
    }

    if (itemsRef.current.length > 0 && applyLinesUpdate()) {
      return () => {
        if (dragRef.current) return
        teardown()
      }
    }

    fullRebuild()

    return () => {
      if (dragRef.current) return
      teardown()
    }
  }, [lines, seriesRef, overlayRef, onTpslDragEnd])
}

/** Wrapper for price-line overlay div (shared by candle charts). */
export function chartOverlayStyle(): CSSProperties {
  return { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 100 }
}

export function chartShellStyle(height: number): CSSProperties {
  return { position: 'relative', width: '100%', height }
}
