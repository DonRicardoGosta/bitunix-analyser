import { useState } from 'react'
import { useMarket } from '../../../store/market'
import { useOrderBook } from '../useOrderBook'
import {
  LiquidityLadder,
  DepthCurve,
  ImbalanceMeter,
  RestingLiquidityHeatmap,
} from '../LiquidityPanels'
import { WindowSelector, BinanceNote } from '../controls'
import { Panel, Spinner } from '../../../components/ui/primitives'

export function LiquidityTab() {
  const symbol = useMarket((s) => s.symbol)
  const [windowPct, setWindowPct] = useState(1)
  const { book, isLoading, error } = useOrderBook(symbol)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Resting liquidity from the Binance deep order book (top 1000 levels, refreshed live).
        </p>
        <WindowSelector value={windowPct} onChange={setWindowPct} />
      </div>

      {error ? <BinanceNote error={error} /> : null}
      {isLoading && !book ? (
        <Panel>
          <Spinner label="Loading order book…" />
        </Panel>
      ) : null}

      {book && (
        <>
          <Panel title="Order-book pressure" subtitle="Bid vs ask resting liquidity and likely price bias">
            <ImbalanceMeter book={book} windowPct={windowPct} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel
              title="Liquidity by price level"
              subtitle="How much resting liquidity sits at each price (USD notional)"
            >
              <LiquidityLadder book={book} windowPct={windowPct} />
            </Panel>

            <div className="flex flex-col gap-4">
              <Panel title="Cumulative depth" subtitle="Order-book depth curve around mid">
                <DepthCurve book={book} windowPct={windowPct} />
              </Panel>
              <Panel
                title="Resting liquidity heatmap"
                subtitle="Price × time, intensity = liquidity (accumulates while viewing)"
              >
                <RestingLiquidityHeatmap windowPct={windowPct} />
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
