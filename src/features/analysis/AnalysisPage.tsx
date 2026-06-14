import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useMarket } from '../../store/market'
import { useUiPrefs } from '../../store/uiPrefs'
import { useAnalysisLive } from '../../store/analysisLive'
import { INTERVALS } from '../../lib/bitunix/intervals'
import type { KlineInterval } from '../../lib/bitunix/rest'
import { applyBestSetup, BEST_SETUP, isBestSetupActive } from './setup/bestSetup'
import { SymbolPicker } from './SymbolPicker'
import { FundingWidget } from './FundingWidget'
import { ChartTab } from './tabs/ChartTab'
import { SetupTab } from './tabs/SetupTab'
import { LiquidityTab } from './tabs/LiquidityTab'
import { DerivativesTab } from './tabs/DerivativesTab'
import { FlowTab } from './tabs/FlowTab'
import { ScreenerTab } from './tabs/ScreenerTab'
import { RecommendedTab } from './tabs/RecommendedTab'

type TabKey = 'chart' | 'setup' | 'liquidity' | 'derivatives' | 'flow' | 'screener' | 'recommended'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'chart', label: 'Chart' },
  { key: 'setup', label: 'Setup' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'derivatives', label: 'Derivatives' },
  { key: 'flow', label: 'Order Flow' },
  { key: 'screener', label: 'Screener' },
  { key: 'recommended', label: 'Recommended' },
]

export function AnalysisPage() {
  const symbol = useMarket((s) => s.symbol)
  const interval = useMarket((s) => s.interval)
  const setInterval = useMarket((s) => s.setInterval)
  const priceType = useMarket((s) => s.priceType)
  const setPriceType = useMarket((s) => s.setPriceType)
  const ensureSymbol = useAnalysisLive((s) => s.ensureSymbol)

  const ticketTradeMode = useUiPrefs((s) => s.ticketTradeMode)
  const ticketTpMode = useUiPrefs((s) => s.ticketTpMode)
  const reviewInterval = useUiPrefs((s) => s.statsReviewInterval)
  const bestActive = isBestSetupActive({
    interval,
    tradeMode: ticketTradeMode,
    tpMode: ticketTpMode,
    reviewInterval,
  })

  const [tab, setTab] = useState<TabKey>('chart')

  // Reset accumulated live data (liquidations, depth, trades) when symbol changes.
  useEffect(() => {
    ensureSymbol(symbol)
  }, [symbol, ensureSymbol])

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

        <button
          onClick={applyBestSetup}
          title={`High win-rate preset — ${BEST_SETUP.interval} analysis · single direction · ${BEST_SETUP.tpMode} · review on ${BEST_SETUP.reviewInterval}`}
          className={clsx(
            'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
            bestActive
              ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300'
              : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800',
          )}
        >
          {bestActive ? '\u2713 Best setup' : 'Best setup'}
        </button>

        <div className="ml-auto">
          <FundingWidget symbol={symbol} />
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
              tab === t.key
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'chart' && <ChartTab />}
      {tab === 'setup' && <SetupTab />}
      {tab === 'liquidity' && <LiquidityTab />}
      {tab === 'derivatives' && <DerivativesTab />}
      {tab === 'flow' && <FlowTab />}
      {tab === 'screener' && <ScreenerTab />}
      {tab === 'recommended' && <RecommendedTab onAnalyze={() => setTab('chart')} />}
    </div>
  )
}
