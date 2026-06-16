import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useMarket } from '../../../store/market'
import { useTickers } from '../../../store/tickers'
import { useCandles } from '../useCandles'
import { useOrderBook } from '../useOrderBook'
import { usePendingPositions, usePositionTpsl } from '../../stats/useStats'
import { buildPositionChartLines } from '../../stats/positionChart'
import { positionPnlAt } from '../../stats/positions'
import { buildModifyTpslParams, usePositionMutations } from '../../stats/usePositionMutations'
import { computeKeyLevels } from '../setup/engine'
import { roundToPrecision } from '../setup/order'
import { useSymbolSpecs } from '../useSymbolSpecs'
import { pickChartZones } from '../chartLevels'
import { CandlesChart, type OverlayToggles } from '../../../components/charts/CandlesChart'
import type { PriceLineDef, PriceLineDragMeta } from '../../../components/charts/chartTypes'
import { ChartPositionsPanel } from './ChartPositionsPanel'
import { TpslDragConfirmModal } from './TpslDragConfirmModal'
import { RsiPanel, MacdPanel, StochRsiPanel } from '../IndicatorPanels'
import { Panel, Spinner, ErrorNote } from '../../../components/ui/primitives'
import { atr } from '../../../lib/indicators'
import { fmtSignedUsd } from '../../../lib/format'
import type { Candle } from '../../../lib/candles'

const OVERLAY_LABELS: { key: keyof OverlayToggles; label: string }[] = [
  { key: 'ema9', label: 'EMA 9' },
  { key: 'ema21', label: 'EMA 21' },
  { key: 'ema50', label: 'EMA 50' },
  { key: 'bb', label: 'Bollinger' },
  { key: 'vwap', label: 'VWAP' },
]

function lastAtr(candles: Candle[]): number {
  const series = atr(candles, 14)
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i]
    if (v !== null && Number.isFinite(v)) return v
  }
  const price = candles[candles.length - 1]?.close ?? 0
  return price * 0.01
}

export function ChartTab() {
  const symbol = useMarket((s) => s.symbol)
  const interval = useMarket((s) => s.interval)
  const priceType = useMarket((s) => s.priceType)

  const [overlays, setOverlays] = useState<OverlayToggles>({
    ema9: true,
    ema21: false,
    ema50: true,
    bb: false,
    vwap: true,
  })
  const [subPanels, setSubPanels] = useState({ rsi: true, macd: true, stoch: false })
  const [showPositions, setShowPositions] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [dragConfirm, setDragConfirm] = useState<{
    meta: PriceLineDragMeta
    fromPrice: number
    toPrice: number
  } | null>(null)

  const { candles, status, error } = useCandles(symbol, interval, priceType)
  const { book } = useOrderBook(symbol)
  const { spec } = useSymbolSpecs(symbol)
  const { modifyTpslMut } = usePositionMutations()

  const pending = usePendingPositions()
  const tpsl = usePositionTpsl()
  const tickers = useTickers((s) => s.map)

  const mine = useMemo(
    () => (pending.data ?? []).filter((p) => p.symbol === symbol),
    [pending.data, symbol],
  )

  const lastPrice = tickers[symbol]?.last ?? (candles.length ? candles[candles.length - 1].close : 0)

  const priceZones = useMemo(() => {
    if (!showZones || candles.length < 30) return []
    const levels = computeKeyLevels(candles, book, lastPrice)
    const atrVal = lastAtr(candles)
    return pickChartZones(levels, candles, lastPrice, atrVal, book)
  }, [showZones, candles, book, lastPrice])

  const positionLines = useMemo<PriceLineDef[]>(() => {
    if (!showPositions || mine.length === 0) return []
    let lines = buildPositionChartLines(mine, tpsl.data)
    if (dragConfirm) {
      lines = lines.map((line) => {
        if (
          line.draggable?.orderId === dragConfirm.meta.orderId &&
          line.draggable.kind === dragConfirm.meta.kind
        ) {
          const pnl = positionPnlAt(
            line.draggable.side,
            line.draggable.entry,
            dragConfirm.toPrice,
            line.draggable.qty,
          )
          return {
            ...line,
            price: dragConfirm.toPrice,
            subtitle: Number.isFinite(pnl) ? fmtSignedUsd(pnl) : undefined,
          }
        }
        return line
      })
    }
    return lines
  }, [showPositions, mine, tpsl.data, dragConfirm])

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={`${symbol} · ${interval}`}
        subtitle="Bitunix price candles with indicator overlays"
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {OVERLAY_LABELS.map((o) => (
              <button
                key={o.key}
                onClick={() => setOverlays((prev) => ({ ...prev, [o.key]: !prev[o.key] }))}
                className={clsx(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium',
                  overlays[o.key]
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'border border-zinc-800 text-zinc-500 hover:text-zinc-300',
                )}
              >
                {o.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-zinc-800" />
            <button
              onClick={() => setShowZones((v) => !v)}
              className={clsx(
                'rounded-md px-2 py-0.5 text-[11px] font-medium',
                showZones
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'border border-zinc-800 text-zinc-500 hover:text-zinc-300',
              )}
            >
              S/R zones
            </button>
            {mine.length > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-zinc-800" />
                <button
                  onClick={() => setShowPositions((v) => !v)}
                  className={clsx(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium',
                    showPositions
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'border border-zinc-800 text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  Positions ({mine.length})
                </button>
              </>
            )}
          </div>
        }
      >
        {status === 'loading' && <Spinner label="Loading candles…" />}
        {status === 'error' && <ErrorNote error={error} />}
        <div className={status === 'loading' ? 'hidden' : ''}>
          <CandlesChart
            candles={candles}
            overlays={overlays}
            priceLines={positionLines}
            priceZones={priceZones}
            height={460}
            onTpslDragEnd={setDragConfirm}
            quotePrecision={spec.quotePrecision}
            pinnedTpslOrderId={dragConfirm?.meta.orderId ?? null}
            pinnedTpslKind={dragConfirm?.meta.kind ?? null}
          />
        </div>
      </Panel>

      {mine.length > 0 && (
        <ChartPositionsPanel positions={mine} tpslOrders={tpsl.data} />
      )}

      {dragConfirm && (
        <TpslDragConfirmModal
          meta={dragConfirm.meta}
          fromPrice={dragConfirm.fromPrice}
          toPrice={dragConfirm.toPrice}
          pending={modifyTpslMut.isPending}
          error={modifyTpslMut.error}
          onCancel={() => setDragConfirm(null)}
          onConfirm={() => {
            const order = tpsl.data?.find((o) => o.id === dragConfirm.meta.orderId)
            if (!order) return
            const priceStr = String(roundToPrecision(dragConfirm.toPrice, spec.quotePrecision))
            const qtyStr = String(roundToPrecision(dragConfirm.meta.qty, spec.basePrecision))
            modifyTpslMut.mutate(
              buildModifyTpslParams(order, dragConfirm.meta.kind, priceStr, qtyStr),
              { onSuccess: () => setDragConfirm(null) },
            )
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            ['rsi', 'RSI'],
            ['macd', 'MACD'],
            ['stoch', 'Stoch RSI'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubPanels((p) => ({ ...p, [key]: !p[key] }))}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs font-medium',
              subPanels[key]
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'border border-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {status === 'ready' && (
        <div className="grid grid-cols-1 gap-4">
          {subPanels.rsi && (
            <Panel title="RSI (14)">
              <RsiPanel candles={candles} />
            </Panel>
          )}
          {subPanels.macd && (
            <Panel title="MACD (12, 26, 9)">
              <MacdPanel candles={candles} />
            </Panel>
          )}
          {subPanels.stoch && (
            <Panel title="Stochastic RSI">
              <StochRsiPanel candles={candles} />
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}
