import { useState } from 'react'
import { useMarket } from '../../store/market'
import { INTERVALS } from '../../lib/bitunix/intervals'
import type { KlineInterval } from '../../lib/bitunix/rest'
import { useCandles } from './useCandles'
import { CandlesChart, type OverlayToggles } from '../../components/charts/CandlesChart'
import { RsiPanel, MacdPanel, StochRsiPanel } from './IndicatorPanels'
import { SymbolPicker } from './SymbolPicker'
import { Panel, Spinner, ErrorNote } from '../../components/ui/primitives'
import clsx from 'clsx'

const OVERLAY_LABELS: { key: keyof OverlayToggles; label: string }[] = [
  { key: 'ema9', label: 'EMA 9' },
  { key: 'ema21', label: 'EMA 21' },
  { key: 'ema50', label: 'EMA 50' },
  { key: 'bb', label: 'Bollinger' },
  { key: 'vwap', label: 'VWAP' },
]

export function AnalysisPage() {
  const symbol = useMarket((s) => s.symbol)
  const interval = useMarket((s) => s.interval)
  const setInterval = useMarket((s) => s.setInterval)
  const priceType = useMarket((s) => s.priceType)
  const setPriceType = useMarket((s) => s.setPriceType)

  const [overlays, setOverlays] = useState<OverlayToggles>({
    ema9: true,
    ema21: false,
    ema50: true,
    bb: false,
    vwap: true,
  })
  const [subPanels, setSubPanels] = useState({ rsi: true, macd: true, stoch: false })

  const { candles, status, error } = useCandles(symbol, interval, priceType)

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <SymbolPicker />

        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
          {INTERVALS.map((iv: KlineInterval) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                interval === iv ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {iv}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
          {(['LAST_PRICE', 'MARK_PRICE'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setPriceType(t)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                priceType === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {t === 'LAST_PRICE' ? 'Last' : 'Mark'}
            </button>
          ))}
        </div>
      </div>

      {/* Price chart */}
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
          </div>
        }
      >
        {status === 'loading' && <Spinner label="Loading candles…" />}
        {status === 'error' && <ErrorNote error={error} />}
        <div className={status === 'loading' ? 'hidden' : ''}>
          <CandlesChart candles={candles} overlays={overlays} height={460} />
        </div>
      </Panel>

      {/* Secondary indicators */}
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
