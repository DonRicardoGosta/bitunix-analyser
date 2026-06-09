import { useQuery } from '@tanstack/react-query'
import { useMarket } from '../../../store/market'
import { getKline } from '../../../lib/bitunix/rest'
import { parseKlines } from '../../../lib/candles'
import { useTradeStream } from '../useTradeStream'
import { CvdChart, FlowStats, TradeTape, VolumeProfileChart } from '../FlowPanels'
import { Panel, Spinner, ErrorNote } from '../../../components/ui/primitives'

export function FlowTab() {
  const symbol = useMarket((s) => s.symbol)
  const interval = useMarket((s) => s.interval)

  useTradeStream(symbol)

  const klines = useQuery({
    queryKey: ['vpKlines', symbol, interval],
    queryFn: async () => parseKlines(await getKline({ symbol, interval, limit: 200 })),
    staleTime: 30_000,
    retry: 0,
  })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Order flow from the live Binance trade stream · volume profile from Bitunix candles.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel title="Cumulative Volume Delta (CVD)" subtitle="Net aggressor volume since you opened this view">
            <CvdChart />
          </Panel>
          <Panel title="Aggressor flow">
            <FlowStats />
          </Panel>
        </div>
        <Panel title="Trade tape" subtitle="Live prints (green = buy, red = sell)">
          <TradeTape />
        </Panel>
      </div>

      <Panel
        title="Volume profile (VPVR)"
        subtitle="Volume by price · amber = POC, cyan = value area (70%)"
      >
        {klines.isLoading ? (
          <Spinner />
        ) : klines.error ? (
          <ErrorNote error={klines.error} />
        ) : (
          <VolumeProfileChart candles={klines.data ?? []} />
        )}
      </Panel>
    </div>
  )
}
