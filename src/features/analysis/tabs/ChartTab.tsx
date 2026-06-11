import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useMarket } from '../../../store/market'
import { useTickers } from '../../../store/tickers'
import { useCandles } from '../useCandles'
import { usePendingPositions, usePositionTpsl } from '../../stats/useStats'
import { buildTpslMap, positionOutcome } from '../../stats/positions'
import { CandlesChart, type OverlayToggles } from '../../../components/charts/CandlesChart'
import type { PriceLineDef } from '../../../components/charts/SetupChart'
import { RsiPanel, MacdPanel, StochRsiPanel } from '../IndicatorPanels'
import { Panel, Spinner, ErrorNote } from '../../../components/ui/primitives'
import { toNum } from '../../../lib/format'

const OVERLAY_LABELS: { key: keyof OverlayToggles; label: string }[] = [
  { key: 'ema9', label: 'EMA 9' },
  { key: 'ema21', label: 'EMA 21' },
  { key: 'ema50', label: 'EMA 50' },
  { key: 'bb', label: 'Bollinger' },
  { key: 'vwap', label: 'VWAP' },
]

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

  const { candles, status, error } = useCandles(symbol, interval, priceType)

  const pending = usePendingPositions()
  const tpsl = usePositionTpsl()
  const tickers = useTickers((s) => s.map)
  const tpslMap = useMemo(() => buildTpslMap(tpsl.data), [tpsl.data])

  const mine = useMemo(
    () => (pending.data ?? []).filter((p) => p.symbol === symbol),
    [pending.data, symbol],
  )

  const positionLines = useMemo<PriceLineDef[]>(() => {
    if (!showPositions || mine.length === 0) return []
    const mark = tickers[symbol]?.last ?? (candles.length ? candles[candles.length - 1].close : 0)
    const out: PriceLineDef[] = []
    mine.forEach((p, i) => {
      const o = positionOutcome(p, tpslMap[p.positionId], mark)
      const tag = mine.length > 1 ? `${o.isLong ? 'L' : 'S'}${i + 1}` : o.isLong ? 'LONG' : 'SHORT'
      const entry = toNum(p.avgOpenPrice)
      const liq = toNum(p.liqPrice)
      out.push({ price: entry, color: o.isLong ? '#22c55e' : '#ef4444', title: `${tag} entry`, width: 2 })
      if (o.tpPrice !== null) out.push({ price: o.tpPrice, color: '#22d3ee', title: `${tag} TP`, dashed: true })
      if (o.slPrice !== null) out.push({ price: o.slPrice, color: '#f43f5e', title: `${tag} SL`, dashed: true })
      if (liq > 0) out.push({ price: liq, color: '#f59e0b', title: `${tag} Liq`, dashed: true })
    })
    return out
  }, [showPositions, mine, tpslMap, tickers, symbol, candles])

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
          <CandlesChart candles={candles} overlays={overlays} priceLines={positionLines} height={460} />
        </div>
      </Panel>

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
