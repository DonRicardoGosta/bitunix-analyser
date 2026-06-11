import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCredentials } from '../../store/credentials'
import {
  useAccount,
  useHistoryPositions,
  useHistoryTrades,
  usePendingPositions,
  usePositionTpsl,
  type RangeParams,
} from './useStats'
import { buildTpslMap, projectedBalances } from './positions'
import { useTickers } from '../../store/tickers'
import { useUiPrefs } from '../../store/uiPrefs'
import {
  bySide,
  bySymbol,
  computePositionStats,
  computeTradeStats,
  holdingDistribution,
  normalizePositions,
  timeHeatmap,
} from './compute'
import {
  equityCurveOption,
  heatmapOption,
  holdingOption,
  sideOption,
  symbolBarOption,
} from './statCharts'
import { EChart } from '../../components/charts/EChart'
import { Panel, StatCard, Spinner, ErrorNote, EmptyState } from '../../components/ui/primitives'
import { PositionsTable } from './PositionsTable'
import {
  fmtUsd,
  fmtSignedUsd,
  fmtPct,
  fmtCompact,
  fmtDuration,
  toNum,
  pnlColor,
  toDatetimeLocal,
  fromDatetimeLocal,
} from '../../lib/format'

const HOUR = 3_600_000
const DAY = 86_400_000

const PRESETS = [
  { label: '1H', ms: HOUR },
  { label: '4H', ms: 4 * HOUR },
  { label: '12H', ms: 12 * HOUR },
  { label: '24H', ms: 24 * HOUR },
  { label: '7D', ms: 7 * DAY },
  { label: '30D', ms: 30 * DAY },
  { label: '90D', ms: 90 * DAY },
  { label: '180D', ms: 180 * DAY },
]

export function StatsPage() {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const mode = useUiPrefs((s) => s.statsMode)
  const lookbackMs = useUiPrefs((s) => s.statsLookbackMs)
  const fromInput = useUiPrefs((s) => s.statsFrom)
  const toInput = useUiPrefs((s) => s.statsTo)
  const toNow = useUiPrefs((s) => s.statsToNow)
  const setStats = useUiPrefs((s) => s.setStats)

  // Debounce the custom inputs so editing dates doesn't spam the history API.
  const [committedFrom, setCommittedFrom] = useState(fromInput)
  const [committedTo, setCommittedTo] = useState(toInput)
  useEffect(() => {
    const id = setTimeout(() => {
      setCommittedFrom(fromInput)
      setCommittedTo(toInput)
    }, 500)
    return () => clearTimeout(id)
  }, [fromInput, toInput])

  const range: RangeParams =
    mode === 'custom'
      ? { from: fromDatetimeLocal(committedFrom), to: toNow ? undefined : fromDatetimeLocal(committedTo) }
      : { lookbackMs }

  const rangeLabel =
    mode === 'custom'
      ? `${new Date(fromDatetimeLocal(committedFrom)).toLocaleString()} → ${
          toNow ? 'now' : new Date(fromDatetimeLocal(committedTo)).toLocaleString()
        }`
      : `last ${PRESETS.find((p) => p.ms === lookbackMs)?.label ?? ''}`

  const account = useAccount()
  const pending = usePendingPositions()
  const tpsl = usePositionTpsl()
  const histPos = useHistoryPositions(range)
  const histTrades = useHistoryTrades(range)

  const tickers = useTickers((s) => s.map)
  const tpslMap = useMemo(() => buildTpslMap(tpsl.data), [tpsl.data])

  const positions = useMemo(() => normalizePositions(histPos.data ?? []), [histPos.data])
  const stats = useMemo(() => computePositionStats(positions), [positions])
  const tradeStats = useMemo(() => computeTradeStats(histTrades.data ?? []), [histTrades.data])
  const symbolRows = useMemo(() => bySymbol(positions), [positions])
  const sideRows = useMemo(() => bySide(positions), [positions])
  const heat = useMemo(() => timeHeatmap(positions), [positions])
  const holds = useMemo(() => holdingDistribution(positions), [positions])

  if (!hasKeys) {
    return (
      <Panel>
        <EmptyState
          title="Connect your Bitunix account to see statistics"
          hint="Add your API key on the Settings page."
        />
        <div className="mt-3 flex justify-center">
          <Link
            to="/settings"
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400"
          >
            Go to Settings
          </Link>
        </div>
      </Panel>
    )
  }

  const acct = account.data
  const available = toNum(acct?.available)
  const margin = toNum(acct?.margin)
  const frozen = toNum(acct?.frozen)
  const unrealized = toNum(acct?.crossUnrealizedPNL) + toNum(acct?.isolationUnrealizedPNL)
  const wallet = available + margin + frozen
  const equity = wallet + unrealized
  const proj = projectedBalances(
    pending.data ?? [],
    tpslMap,
    wallet,
    (s) => tickers[s]?.last ?? 0,
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Account Statistics</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {acct?.marginCoin ?? 'USDT'}-margined futures · {rangeLabel}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 p-1">
            {PRESETS.map((p) => {
              const active = mode === 'preset' && lookbackMs === p.ms
              return (
                <button
                  key={p.label}
                  onClick={() => setStats({ statsMode: 'preset', statsLookbackMs: p.ms })}
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-medium ' +
                    (active ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200')
                  }
                >
                  {p.label}
                </button>
              )
            })}
            <button
              onClick={() => setStats({ statsMode: 'custom' })}
              className={
                'rounded-md px-2.5 py-1 text-xs font-medium ' +
                (mode === 'custom' ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200')
              }
            >
              Custom
            </button>
          </div>

          {mode === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 p-2 text-xs">
              <label className="flex items-center gap-1.5 text-zinc-400">
                From
                <input
                  type="datetime-local"
                  value={fromInput}
                  onChange={(e) => setStats({ statsFrom: e.target.value })}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-cyan-500"
                />
              </label>
              <label className="flex items-center gap-1.5 text-zinc-400">
                To
                <input
                  type="datetime-local"
                  value={toNow ? toDatetimeLocal(Date.now()) : toInput}
                  disabled={toNow}
                  onChange={(e) => setStats({ statsTo: e.target.value })}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-1.5 text-zinc-300">
                <input
                  type="checkbox"
                  checked={toNow}
                  onChange={(e) => setStats({ statsToNow: e.target.checked })}
                  className="accent-cyan-500"
                />
                Now (real-time)
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Equity" value={fmtUsd(equity)} sub={`Wallet ${fmtUsd(wallet)}`} />
        <StatCard label="Available" value={fmtUsd(available)} />
        <StatCard
          label="If all TP hit"
          value={fmtUsd(proj.ifTp)}
          sub={fmtSignedUsd(proj.tpDelta)}
          tone="up"
        />
        <StatCard
          label="If all SL hit"
          value={fmtUsd(proj.ifSl)}
          sub={fmtSignedUsd(proj.slDelta)}
          tone="down"
        />
        <StatCard label="Used Margin" value={fmtUsd(margin)} sub={`Frozen ${fmtUsd(frozen)}`} />
        <StatCard
          label="Unrealized PnL"
          value={fmtSignedUsd(unrealized)}
          tone={unrealized >= 0 ? 'up' : 'down'}
        />
        <StatCard label="Open positions" value={pending.data?.length ?? 0} />
      </div>

      {account.error && <ErrorNote error={account.error} />}

      {/* Open positions */}
      <Panel
        title="Open positions"
        actions={pending.isFetching ? <Spinner /> : undefined}
      >
        {pending.isLoading ? (
          <Spinner />
        ) : (
          <PositionsTable positions={pending.data ?? []} tpslMap={tpslMap} />
        )}
      </Panel>

      {/* Performance summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Net PnL"
          value={fmtSignedUsd(stats.totalNet)}
          tone={stats.totalNet >= 0 ? 'up' : 'down'}
          sub={`${stats.count} closed`}
        />
        <StatCard label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} />
        <StatCard
          label="Profit factor"
          value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}
        />
        <StatCard label="Expectancy" value={fmtSignedUsd(stats.expectancy)} sub="per trade" />
        <StatCard label="Max drawdown" value={fmtUsd(stats.maxDrawdown)} tone="down" sub={fmtPct(stats.maxDrawdownPct)} />
        <StatCard label="Avg hold" value={fmtDuration(stats.avgHoldMs)} />
      </div>

      {histPos.isLoading ? (
        <Panel><Spinner label="Loading trade history…" /></Panel>
      ) : histPos.error ? (
        <Panel><ErrorNote error={histPos.error} /></Panel>
      ) : positions.length === 0 ? (
        <Panel><EmptyState title="No closed positions in this window" hint="Try a longer time range." /></Panel>
      ) : (
        <>
          <Panel title="Equity curve" subtitle="Cumulative net PnL with drawdown shading">
            <EChart option={equityCurveOption(stats.equityCurve)} height={300} />
          </Panel>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="PnL by symbol">
              <EChart option={symbolBarOption(symbolRows)} height={300} />
            </Panel>
            <Panel title="Long vs Short">
              <EChart option={sideOption(sideRows)} height={300} />
              <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                {sideRows.map((r) => (
                  <div key={r.side} className="rounded-lg border border-zinc-800 p-2">
                    <div className="text-zinc-500">{r.side}</div>
                    <div className={pnlColor(r.net) + ' tabular text-sm font-medium'}>{fmtSignedUsd(r.net)}</div>
                    <div className="text-zinc-500 tabular">
                      {r.count} trades · {(r.winRate * 100).toFixed(0)}% win
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="PnL by weekday × hour" subtitle="When are you most profitable (close time)">
              <EChart option={heatmapOption(heat)} height={260} />
            </Panel>
            <Panel title="Holding time distribution">
              <EChart option={holdingOption(holds)} height={260} />
            </Panel>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <StatCard label="Gross PnL" value={fmtSignedUsd(stats.totalGross)} tone={stats.totalGross >= 0 ? 'up' : 'down'} />
            <StatCard label="Fees paid" value={fmtUsd(stats.totalFees)} tone="down" />
            <StatCard label="Funding" value={fmtSignedUsd(stats.totalFunding)} tone={stats.totalFunding >= 0 ? 'up' : 'down'} />
            <StatCard label="Best trade" value={fmtSignedUsd(stats.bestTrade)} tone="up" />
            <StatCard label="Worst trade" value={fmtSignedUsd(stats.worstTrade)} tone="down" />
            <StatCard label="Volume" value={`$${fmtCompact(tradeStats.volume)}`} sub={`${tradeStats.count} fills`} />
          </div>
        </>
      )}
    </div>
  )
}
