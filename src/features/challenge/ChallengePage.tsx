import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import { useCredentials } from '../../store/credentials'
import { useChallenge } from '../../store/challenge'
import { useAccount, useHistoryPositions, type RangeParams } from '../stats/useStats'
import { normalizePositions } from '../stats/compute'
import { accountEquity, computeChallenge, type ChallengeStatus } from './compute'
import { EChart } from '../../components/charts/EChart'
import { baseTooltip, darkChart, referenceMarkLine } from '../../components/charts/chartTheme'
import { Panel, StatCard, Badge, Spinner, ErrorNote, EmptyState } from '../../components/ui/primitives'
import {
  fmtUsd,
  fmtSignedUsd,
  fmtPct,
  toNum,
  pnlColor,
  toDatetimeLocal,
  fromDatetimeLocal,
} from '../../lib/format'

const INPUT =
  'rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-cyan-500'

const STATUS_META: Record<ChallengeStatus, { tone: 'up' | 'down' | 'accent'; label: string }> = {
  passed: { tone: 'up', label: 'Passed' },
  failed: { tone: 'down', label: 'Failed' },
  active: { tone: 'accent', label: 'In progress' },
}

export function ChallengePage() {
  const hasKeys = useCredentials((s) => s.hasKeys())
  const startBalance = useChallenge((s) => s.startBalance)
  const profitTargetPct = useChallenge((s) => s.profitTargetPct)
  const maxDrawdownPct = useChallenge((s) => s.maxDrawdownPct)
  const startTime = useChallenge((s) => s.startTime)
  const marginPerTradePct = useChallenge((s) => s.marginPerTradePct)
  const takeProfitPct = useChallenge((s) => s.takeProfitPct)
  const setChallenge = useChallenge((s) => s.setChallenge)
  const reset = useChallenge((s) => s.reset)

  const account = useAccount()
  const range: RangeParams = useMemo(() => ({ from: startTime }), [startTime])
  const histPos = useHistoryPositions(range)

  const equity = useMemo(() => accountEquity(account.data).equity, [account.data])
  const positions = useMemo(() => normalizePositions(histPos.data ?? []), [histPos.data])
  const ch = useMemo(
    () =>
      computeChallenge(
        { startBalance, profitTargetPct, maxDrawdownPct, startTime, marginPerTradePct, takeProfitPct },
        equity,
        positions,
      ),
    [startBalance, profitTargetPct, maxDrawdownPct, startTime, marginPerTradePct, takeProfitPct, equity, positions],
  )

  const chartOption: EChartsOption = useMemo(() => {
    const data = ch.curve.map((p) => [p.time, p.equity] as [number, number])
    return {
      grid: { left: 60, right: 16, top: 20, bottom: 30 },
      tooltip: { ...baseTooltip(), trigger: 'axis', valueFormatter: (v) => fmtUsd(v as number) },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: darkChart.gridColor } },
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => fmtUsd(v, 0) },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)' } },
      },
      series: [
        {
          name: 'Equity',
          type: 'line',
          showSymbol: false,
          data,
          lineStyle: { color: darkChart.accent, width: 2 },
          areaStyle: { color: 'rgba(34,211,238,0.10)' },
          markLine: referenceMarkLine([
            { yAxis: ch.targetEquity, label: `Target ${fmtUsd(ch.targetEquity, 0)}`, color: darkChart.up },
            { yAxis: ch.floorEquity, label: `Floor ${fmtUsd(ch.floorEquity, 0)}`, color: darkChart.down },
            { yAxis: ch.startBalance, label: `Start ${fmtUsd(ch.startBalance, 0)}`, color: '#64748b' },
          ]),
        },
      ],
    }
  }, [ch])

  if (!hasKeys) {
    return (
      <Panel>
        <EmptyState
          title="Connect your Bitunix account to track a challenge"
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

  const status = STATUS_META[ch.status]
  const targetGap = Math.max(0, ch.targetEquity - ch.equity)
  const progressPct = ch.progress * 100

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Account Challenge</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Grow {fmtUsd(ch.startBalance)} to {fmtUsd(ch.targetEquity)} without breaching a{' '}
            {ch.drawdownLimitPct}% drawdown · since {new Date(startTime).toLocaleDateString()}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {/* Configuration */}
      <Panel title="Challenge settings" subtitle="Stored locally in your browser">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Start balance (USDT)
            <input
              type="number"
              min={0}
              value={startBalance}
              onChange={(e) => setChallenge({ startBalance: toNum(e.target.value) })}
              className={INPUT + ' w-32'}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Profit target (%)
            <input
              type="number"
              min={0}
              value={profitTargetPct}
              onChange={(e) => setChallenge({ profitTargetPct: toNum(e.target.value) })}
              className={INPUT + ' w-28'}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Max drawdown (%)
            <input
              type="number"
              min={0}
              max={100}
              value={maxDrawdownPct}
              onChange={(e) => setChallenge({ maxDrawdownPct: toNum(e.target.value) })}
              className={INPUT + ' w-28'}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Margin / trade (%)
            <input
              type="number"
              min={0}
              max={100}
              value={marginPerTradePct}
              onChange={(e) => setChallenge({ marginPerTradePct: toNum(e.target.value) })}
              className={INPUT + ' w-28'}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Take profit (%)
            <input
              type="number"
              min={0}
              value={takeProfitPct}
              onChange={(e) => setChallenge({ takeProfitPct: toNum(e.target.value) })}
              className={INPUT + ' w-28'}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Start date
            <input
              type="datetime-local"
              value={toDatetimeLocal(startTime)}
              onChange={(e) => setChallenge({ startTime: fromDatetimeLocal(e.target.value) })}
              className={INPUT}
            />
          </label>
          <button
            onClick={() => reset(toNum(equity, startBalance))}
            title="Start a fresh run from your current equity, ignoring earlier trades"
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Restart from current equity
          </button>
        </div>
      </Panel>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Equity" value={fmtUsd(ch.equity)} sub={`Start ${fmtUsd(ch.startBalance)}`} />
        <StatCard
          label="Profit / Loss"
          value={fmtSignedUsd(ch.profit)}
          sub={fmtPct(ch.profitPct)}
          tone={ch.profit >= 0 ? 'up' : 'down'}
        />
        <StatCard
          label="Target"
          value={fmtUsd(ch.targetEquity)}
          sub={targetGap > 0 ? `Need ${fmtUsd(targetGap)}` : 'Reached'}
          tone={targetGap > 0 ? 'default' : 'up'}
        />
        <StatCard label="Progress" value={`${progressPct.toFixed(0)}%`} />
        <StatCard
          label="Drawdown"
          value={`-${ch.currentDrawdownPct.toFixed(1)}%`}
          sub={`Max -${ch.maxDrawdownPct.toFixed(1)}% / limit ${ch.drawdownLimitPct}%`}
          tone="down"
        />
        <StatCard label="Peak equity" value={fmtUsd(ch.peakEquity)} sub={`${ch.tradeCount} trades`} />
        <StatCard
          label="Trades to target"
          value={ch.status === 'passed' ? 'Reached' : Number.isFinite(ch.tradesToTarget) ? ch.tradesToTarget : '\u221e'}
          sub={`+${fmtUsd(ch.perTradeGainUsd)}/win · ${ch.perTradeGainPct.toFixed(2)}%`}
          tone={ch.status === 'passed' ? 'up' : 'default'}
        />
      </div>

      {account.error && <ErrorNote error={account.error} />}

      {/* Progress bars */}
      <Panel>
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Target progress</span>
              <span className="text-zinc-300 tabular">
                {fmtUsd(ch.equity)} / {fmtUsd(ch.targetEquity)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Drawdown used</span>
              <span className="text-zinc-300 tabular">
                {ch.drawdownUsedPct.toFixed(0)}% of {ch.drawdownLimitPct}% limit
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={
                  'h-full rounded-full transition-all ' +
                  (ch.drawdownUsedPct >= 80 ? 'bg-rose-500' : 'bg-amber-500')
                }
                style={{ width: `${ch.drawdownUsedPct}%` }}
              />
            </div>
          </div>
        </div>
      </Panel>

      {/* Equity curve */}
      <Panel
        title="Equity curve"
        subtitle="Start balance plus realized PnL, ending at live equity"
        actions={histPos.isFetching ? <Spinner /> : null}
      >
        {histPos.isLoading ? (
          <Spinner label="Loading trade history…" />
        ) : histPos.error ? (
          <ErrorNote error={histPos.error} />
        ) : (
          <EChart option={chartOption} height={300} />
        )}
      </Panel>

      {/* Daily PnL */}
      <Panel title="Daily PnL" subtitle="Realized net per day inside the challenge window">
        {ch.days.length === 0 ? (
          <EmptyState title="No closed trades yet" hint="Trades since the start date will show here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 text-right font-medium">Trades</th>
                  <th className="py-2 text-right font-medium">Net PnL</th>
                </tr>
              </thead>
              <tbody>
                {ch.days.map((d) => (
                  <tr key={d.day} className="border-t border-zinc-800">
                    <td className="py-2 pr-4 text-zinc-300">{new Date(d.day).toLocaleDateString()}</td>
                    <td className="py-2 pr-4 text-right text-zinc-400 tabular">{d.trades}</td>
                    <td className={'py-2 text-right tabular ' + pnlColor(d.net)}>{fmtSignedUsd(d.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
