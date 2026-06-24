import { NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useTickersPoll } from '../../hooks/useTickersPoll'
import { useTickers } from '../../store/tickers'
import { useMarket } from '../../store/market'
import { useCredentials } from '../../store/credentials'
import { useBuilderShedWatcher } from '../../features/analysis/setup/useBuilderShedWatcher'
import { ConnectionDot } from '../ui/primitives'
import { fmtPrice, fmtPct, pnlColor } from '../../lib/format'

const NAV = [
  { to: '/analysis', label: 'Coin Analysis', icon: '◈' },
  { to: '/stats', label: 'Statistics', icon: '▤' },
  { to: '/challenge', label: 'Challenge', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function AppLayout() {
  useTickersPoll()
  useBuilderShedWatcher()
  const connected = useTickers((s) => s.connected)
  const symbol = useMarket((s) => s.symbol)
  const ticker = useTickers((s) => s.map[symbol])
  const hasKeys = useCredentials((s) => s.hasKeys())
  const location = useLocation()

  return (
    <div className="flex h-full min-h-screen bg-[#070a10]">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800/70 bg-[#0a0e16]">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
            ◮
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-zinc-100">Bitunix</div>
            <div className="text-[11px] leading-tight text-zinc-500">Futures Analytics</div>
          </div>
        </div>

        <nav className="mt-2 flex flex-col gap-1 px-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
                )
              }
            >
              <span className="w-4 text-center text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto px-3 py-3 text-[11px] text-zinc-600">
          <div className="mb-1 flex items-center justify-between">
            <span>Account</span>
            <span className={hasKeys ? 'text-emerald-400' : 'text-amber-400'}>
              {hasKeys ? 'Connected' : 'No keys'}
            </span>
          </div>
          <p className="leading-relaxed">
            Local app · no database. Liquidity &amp; derivatives data from Binance public API.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-800/70 bg-[#0a0e16]/80 px-5 py-3 backdrop-blur">
          <div className="flex items-baseline gap-3">
            <span className="text-base font-semibold text-zinc-100">{symbol}</span>
            {ticker ? (
              <>
                <span className="text-base tabular text-zinc-200">{fmtPrice(ticker.last)}</span>
                <span className={clsx('text-sm tabular', pnlColor(ticker.changePct))}>
                  {fmtPct(ticker.changePct)}
                </span>
              </>
            ) : (
              <span className="text-sm text-zinc-600">price loading…</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs capitalize text-zinc-500">
              {location.pathname.replace('/', '') || 'analysis'}
            </span>
            <ConnectionDot connected={connected} />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
