import { useMarket } from '../../../store/market'
import { toBinancePeriod } from '../../../lib/bitunix/intervals'
import { useLiquidationStream } from '../useLiquidationStream'
import { useOpenInterest, useLongShort, useTakerFlow, usePriceSeries } from '../useDerivatives'
import {
  OpenInterestChart,
  LongShortChart,
  TakerFlowChart,
  LiquidationMap,
  LiquidationStats,
  LiquidationTape,
} from '../DerivativesPanels'
import { Panel, Spinner } from '../../../components/ui/primitives'
import { BinanceNote } from '../controls'

export function DerivativesTab() {
  const symbol = useMarket((s) => s.symbol)
  const interval = useMarket((s) => s.interval)
  const period = toBinancePeriod(interval)

  useLiquidationStream(symbol)

  const oi = useOpenInterest(symbol, period)
  const ls = useLongShort(symbol, period)
  const taker = useTakerFlow(symbol, period)
  const price = usePriceSeries(symbol, period)

  const anyError = oi.error || ls.error || taker.error || price.error

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Derivatives metrics from Binance public data · {period} resolution. Live liquidations stream in
        real time.
      </p>

      {anyError ? <BinanceNote error={anyError} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Liquidation map (live)" subtitle="Forced liquidations: price × time, size = notional">
          <LiquidationMap />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Liquidation balance">
            <LiquidationStats />
          </Panel>
          <Panel title="Liquidation tape">
            <LiquidationTape />
          </Panel>
        </div>
      </div>

      <Panel title="Open interest" subtitle="Total OI value vs price (divergence = potential reversal/squeeze)">
        {oi.isLoading ? <Spinner /> : <OpenInterestChart oi={oi.data ?? []} price={price.data ?? []} />}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Long / Short ratio" subtitle="All accounts vs top traders (>1 = more longs)">
          {ls.isLoading ? (
            <Spinner />
          ) : (
            <LongShortChart global={ls.data?.global ?? []} top={ls.data?.top ?? []} price={price.data ?? []} />
          )}
        </Panel>
        <Panel title="Taker buy/sell flow" subtitle="Aggressor ratio (>1 = buyers in control)">
          {taker.isLoading ? <Spinner /> : <TakerFlowChart taker={taker.data ?? []} price={price.data ?? []} />}
        </Panel>
      </div>
    </div>
  )
}
