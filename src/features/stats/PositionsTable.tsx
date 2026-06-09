import type { PendingPositionRaw } from '../../lib/bitunix/types'
import { useTickers } from '../../store/tickers'
import { Badge, EmptyState } from '../../components/ui/primitives'
import { fmtPrice, fmtUsd, fmtSignedUsd, pnlColor, toNum } from '../../lib/format'
import clsx from 'clsx'

export function PositionsTable({ positions }: { positions: PendingPositionRaw[] }) {
  const tickers = useTickers((s) => s.map)

  if (!positions.length) {
    return <EmptyState title="No open positions" hint="Open positions will appear here in real time." />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <th className="px-2 py-2">Symbol</th>
            <th className="px-2 py-2">Side</th>
            <th className="px-2 py-2 text-right">Size</th>
            <th className="px-2 py-2 text-right">Entry</th>
            <th className="px-2 py-2 text-right">Mark</th>
            <th className="px-2 py-2 text-right">Liq.</th>
            <th className="px-2 py-2 text-right">Lev.</th>
            <th className="px-2 py-2 text-right">uPnL</th>
            <th className="px-2 py-2 text-right">Margin</th>
            <th className="px-2 py-2 text-right">To Liq.</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const mark = tickers[p.symbol]?.last ?? toNum(p.avgOpenPrice)
            const liq = toNum(p.liqPrice)
            const upnl = toNum(p.unrealizedPNL)
            const toLiqPct = liq > 0 && mark > 0 ? ((mark - liq) / mark) * 100 * (p.side === 'LONG' ? 1 : -1) : null
            return (
              <tr key={p.positionId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-2 py-2 font-medium text-zinc-100">{p.symbol}</td>
                <td className="px-2 py-2">
                  <Badge tone={p.side === 'LONG' ? 'up' : 'down'}>{p.side}</Badge>
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(p.qty)}</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(p.avgOpenPrice)}</td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtPrice(mark)}</td>
                <td className="px-2 py-2 text-right tabular text-amber-300/80">
                  {liq > 0 ? fmtPrice(liq) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-400">{p.leverage}x</td>
                <td className={clsx('px-2 py-2 text-right tabular', pnlColor(upnl))}>
                  {fmtSignedUsd(upnl)}
                </td>
                <td className="px-2 py-2 text-right tabular text-zinc-300">{fmtUsd(p.margin)}</td>
                <td className="px-2 py-2 text-right tabular">
                  {toLiqPct === null ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    <span className={toLiqPct < 5 ? 'text-rose-400' : 'text-zinc-400'}>
                      {toLiqPct.toFixed(2)}%
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
