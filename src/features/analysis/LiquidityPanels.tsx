import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart, baseTooltip, darkChart } from '../../components/charts/EChart'
import { binLiquidity, cumulativeDepth, imbalance, type ParsedBook } from './orderbook'
import { useAnalysisLive } from '../../store/analysisLive'
import { fmtPrice, fmtCompact } from '../../lib/format'
import { EmptyState } from '../../components/ui/primitives'
import clsx from 'clsx'

/** Horizontal resting-liquidity histogram: how much liquidity sits at each price. */
export function LiquidityLadder({ book, windowPct, bins = 60 }: { book: ParsedBook; windowPct: number; bins?: number }) {
  const option = useMemo<EChartsOption>(() => {
    const { rows } = binLiquidity(book, windowPct, bins)
    const display = [...rows].reverse() // high price on top
    const prices = display.map((r) => fmtPrice(r.price))
    return {
      grid: { left: 70, right: 16, top: 8, bottom: 24 },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => `$${fmtCompact(v as number)}`,
      },
      legend: { show: false },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `$${fmtCompact(v, 0)}` },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      yAxis: {
        type: 'category',
        data: prices,
        inverse: false,
        axisLabel: { color: '#94a3b8', fontSize: 9, interval: Math.floor(bins / 14) },
        axisLine: { lineStyle: { color: darkChart.gridColor } },
      },
      series: [
        {
          name: 'Bids',
          type: 'bar',
          stack: 'total',
          data: display.map((r) => r.bidNotional),
          itemStyle: { color: 'rgba(34,197,94,0.75)' },
          barWidth: '92%',
        },
        {
          name: 'Asks',
          type: 'bar',
          stack: 'total',
          data: display.map((r) => r.askNotional),
          itemStyle: { color: 'rgba(239,68,68,0.75)' },
          barWidth: '92%',
        },
      ],
    }
  }, [book, windowPct, bins])
  return <EChart option={option} height={420} notMerge />
}

/** Classic cumulative depth curve. */
export function DepthCurve({ book, windowPct }: { book: ParsedBook; windowPct: number }) {
  const option = useMemo<EChartsOption>(() => {
    const { bids, asks } = cumulativeDepth(book, windowPct)
    return {
      grid: { left: 56, right: 16, top: 10, bottom: 24 },
      tooltip: {
        ...baseTooltip(),
        trigger: 'axis',
        valueFormatter: (v) => `$${fmtCompact(v as number)}`,
      },
      xAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => fmtPrice(v) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 9, formatter: (v: number) => `$${fmtCompact(v, 0)}` },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.2)' } },
      },
      series: [
        {
          name: 'Bids',
          type: 'line',
          step: 'end',
          showSymbol: false,
          data: bids.map((p) => [p.price, p.cum]),
          lineStyle: { color: darkChart.up, width: 1.5 },
          areaStyle: { color: 'rgba(34,197,94,0.15)' },
        },
        {
          name: 'Asks',
          type: 'line',
          step: 'start',
          showSymbol: false,
          data: asks.map((p) => [p.price, p.cum]),
          lineStyle: { color: darkChart.down, width: 1.5 },
          areaStyle: { color: 'rgba(239,68,68,0.15)' },
        },
      ],
    }
  }, [book, windowPct])
  return <EChart option={option} height={240} notMerge />
}

/** Order-book imbalance / pressure indicator with a directional read. */
export function ImbalanceMeter({ book, windowPct }: { book: ParsedBook; windowPct: number }) {
  const imb = useMemo(() => imbalance(book, windowPct), [book, windowPct])
  const bidPct = imb.total > 0 ? (imb.bidNotional / imb.total) * 100 : 50
  const askPct = 100 - bidPct
  const skew = imb.skew

  let bias = 'Balanced book'
  let tone: 'up' | 'down' | 'neutral' = 'neutral'
  if (skew > 0.15) {
    bias = 'Bid-heavy → support below, upward bias'
    tone = 'up'
  } else if (skew < -0.15) {
    bias = 'Ask-heavy → resistance above, downward bias'
    tone = 'down'
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Bid notional</div>
          <div className="tabular text-sm font-medium text-emerald-400">${fmtCompact(imb.bidNotional)}</div>
        </div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Skew</div>
          <div
            className={clsx(
              'tabular text-lg font-semibold',
              tone === 'up' && 'text-emerald-400',
              tone === 'down' && 'text-rose-400',
              tone === 'neutral' && 'text-zinc-300',
            )}
          >
            {(skew * 100).toFixed(1)}%
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Ask notional</div>
          <div className="tabular text-sm font-medium text-rose-400">${fmtCompact(imb.askNotional)}</div>
        </div>
      </div>

      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-emerald-500/80" style={{ width: `${bidPct}%` }} />
        <div className="bg-rose-500/80" style={{ width: `${askPct}%` }} />
      </div>

      <div
        className={clsx(
          'rounded-lg px-3 py-2 text-center text-sm font-medium',
          tone === 'up' && 'bg-emerald-500/10 text-emerald-300',
          tone === 'down' && 'bg-rose-500/10 text-rose-300',
          tone === 'neutral' && 'bg-zinc-800/60 text-zinc-300',
        )}
      >
        {bias}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-zinc-500">
        <div>
          <div className="tabular text-zinc-300">{Number.isFinite(imb.ratio) ? imb.ratio.toFixed(2) : '∞'}</div>
          Bid/Ask ratio
        </div>
        <div>
          <div className="tabular text-zinc-300">{fmtPrice(book.mid)}</div>
          Mid price
        </div>
        <div>
          <div className="tabular text-zinc-300">{book.spreadPct.toFixed(3)}%</div>
          Spread
        </div>
      </div>
    </div>
  )
}

/** Time x price heatmap of resting liquidity, accumulated over the session. */
export function RestingLiquidityHeatmap({ windowPct, bins = 40 }: { windowPct: number; bins?: number }) {
  const history = useAnalysisLive((s) => s.depthHistory)

  const option = useMemo<EChartsOption | null>(() => {
    if (history.length < 3) return null
    const latestMid = history[history.length - 1].mid
    if (!latestMid) return null
    const low = latestMid * (1 - windowPct / 100)
    const high = latestMid * (1 + windowPct / 100)
    const step = (high - low) / bins
    if (step <= 0) return null

    const data: [number, number, number][] = []
    let maxVal = 0
    history.forEach((snap, t) => {
      const bucket = new Array(bins).fill(0)
      const place = (price: number, notional: number) => {
        if (price < low || price >= high) return
        const idx = Math.min(bins - 1, Math.max(0, Math.floor((price - low) / step)))
        bucket[idx] += notional
      }
      for (const [p, q] of snap.bids) place(p, p * q)
      for (const [p, q] of snap.asks) place(p, p * q)
      for (let b = 0; b < bins; b++) {
        if (bucket[b] > 0) {
          data.push([t, b, bucket[b]])
          maxVal = Math.max(maxVal, bucket[b])
        }
      }
    })
    if (maxVal === 0) return null

    const priceLabels = Array.from({ length: bins }, (_, b) => fmtPrice(low + step * (b + 0.5)))
    const timeLabels = history.map((s) => new Date(s.time).toLocaleTimeString())

    return {
      grid: { left: 70, right: 50, top: 10, bottom: 30 },
      tooltip: {
        ...baseTooltip(),
        formatter: (p) => {
          const v = (p as unknown as { value: [number, number, number] }).value
          return `${timeLabels[v[0]]}<br/>${priceLabels[v[1]]}<br/>$${fmtCompact(v[2])}`
        },
      },
      xAxis: {
        type: 'category',
        data: timeLabels,
        axisLabel: { color: '#64748b', fontSize: 8, interval: Math.floor(history.length / 8) },
        axisLine: { lineStyle: { color: darkChart.gridColor } },
      },
      yAxis: {
        type: 'category',
        data: priceLabels,
        axisLabel: { color: '#94a3b8', fontSize: 8, interval: Math.floor(bins / 12) },
        axisLine: { lineStyle: { color: darkChart.gridColor } },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        calculable: false,
        show: true,
        right: 4,
        top: 'center',
        itemWidth: 8,
        textStyle: { color: '#64748b', fontSize: 8 },
        inRange: { color: ['#0b1220', '#164e63', '#0891b2', '#22d3ee', '#fde047'] },
      },
      series: [{ type: 'heatmap', data, progressive: 4000 }],
    }
  }, [history, windowPct, bins])

  if (!option) {
    return (
      <EmptyState
        title="Building liquidity heatmap…"
        hint="Resting liquidity accumulates from live order-book snapshots since you opened this symbol."
      />
    )
  }
  return <EChart option={option} height={300} notMerge />
}
