import { useMemo, useRef, useState } from 'react'
import { useMarket } from '../../store/market'
import { useTickers, type LiveTicker } from '../../store/tickers'
import { useFavourites } from '../../store/favourites'
import { fmtPrice, fmtPct, fmtCompact, pnlColor } from '../../lib/format'
import clsx from 'clsx'

type SortKey = 'movers' | 'gainers' | 'losers' | 'volume' | 'price' | 'name'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'movers', label: 'Biggest movers (|Δ|)' },
  { key: 'gainers', label: 'Top gainers (Δ ↑)' },
  { key: 'losers', label: 'Top losers (Δ ↓)' },
  { key: 'volume', label: 'Volume' },
  { key: 'price', label: 'Price' },
  { key: 'name', label: 'Name (A–Z)' },
]

function compareBy(sort: SortKey): (a: LiveTicker, b: LiveTicker) => number {
  switch (sort) {
    case 'volume':
      return (a, b) => b.quoteVol - a.quoteVol
    case 'gainers':
      return (a, b) => b.changePct - a.changePct
    case 'losers':
      return (a, b) => a.changePct - b.changePct
    case 'price':
      return (a, b) => b.last - a.last
    case 'name':
      return (a, b) => a.symbol.localeCompare(b.symbol)
    case 'movers':
    default:
      return (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)
  }
}

export function SymbolPicker() {
  const symbol = useMarket((s) => s.symbol)
  const setSymbol = useMarket((s) => s.setSymbol)
  const map = useTickers((s) => s.map)
  const favourites = useFavourites((s) => s.symbols)
  const toggleFav = useFavourites((s) => s.toggle)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'fav'>('all')
  const [sort, setSort] = useState<SortKey>(
    () => (localStorage.getItem('bitunix-picker-sort') as SortKey) || 'movers',
  )
  const ref = useRef<HTMLDivElement | null>(null)

  function changeSort(s: SortKey) {
    setSort(s)
    localStorage.setItem('bitunix-picker-sort', s)
  }

  const isCurrentFav = favourites.includes(symbol)

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase()
    const cmp = compareBy(sort)
    if (tab === 'fav') {
      const favRows: LiveTicker[] = favourites.map(
        (s) => map[s] ?? ({ symbol: s, last: 0, open: 0, high: 0, low: 0, baseVol: 0, quoteVol: 0, changePct: 0, bestBid: 0, bestAsk: 0, ts: 0 } as LiveTicker),
      )
      return favRows.filter((t) => (q ? t.symbol.includes(q) : true)).sort(cmp)
    }
    const arr = Object.values(map)
    const filtered = q ? arr.filter((t) => t.symbol.includes(q)) : arr
    return filtered.sort(cmp).slice(0, 50)
  }, [map, query, tab, favourites, sort])

  function choose(s: string) {
    setSymbol(s)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:border-zinc-600"
      >
        {isCurrentFav && <span className="text-amber-400">★</span>}
        {symbol}
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-[#0c111b] shadow-xl">
            <div className="flex items-center gap-1 border-b border-zinc-800 p-1.5">
              <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>
                All
              </TabBtn>
              <TabBtn active={tab === 'fav'} onClick={() => setTab('fav')}>
                <span className="text-amber-400">★</span> Favourites
                {favourites.length > 0 && <span className="ml-1 text-zinc-500">{favourites.length}</span>}
              </TabBtn>
            </div>

            <div className="p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search symbol (e.g. BTC)"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center gap-2 px-2 pb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">Sort</span>
              <select
                value={sort}
                onChange={(e) => changeSort(e.target.value as SortKey)}
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-80 overflow-y-auto pb-1">
              {rows.length === 0 && (
                <div className="px-3 py-5 text-center text-xs text-zinc-500">
                  {tab === 'fav' ? 'No favourites yet — add coins with the ★' : 'No symbols loaded yet…'}
                </div>
              )}
              {rows.map((t) => (
                <div
                  key={t.symbol}
                  className={clsx(
                    'flex items-center gap-1 px-1.5 hover:bg-zinc-800/60',
                    t.symbol === symbol && 'bg-cyan-500/10',
                  )}
                >
                  <button
                    onClick={() => toggleFav(t.symbol)}
                    title={favourites.includes(t.symbol) ? 'Remove favourite' : 'Add favourite'}
                    className={clsx(
                      'px-1 text-base leading-none',
                      favourites.includes(t.symbol) ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300',
                    )}
                  >
                    {favourites.includes(t.symbol) ? '★' : '☆'}
                  </button>
                  <button
                    onClick={() => choose(t.symbol)}
                    className="flex flex-1 items-center justify-between py-1.5 pr-1.5 text-left text-sm"
                  >
                    <span className="font-medium text-zinc-200">{t.symbol}</span>
                    <span className="flex items-center gap-3 tabular">
                      <span className="text-zinc-400">{t.last ? fmtPrice(t.last) : '—'}</span>
                      <span className={clsx('w-16 text-right', pnlColor(t.changePct))}>
                        {t.last ? fmtPct(t.changePct) : '—'}
                      </span>
                      <span className="w-14 text-right text-zinc-600">{t.quoteVol ? fmtCompact(t.quoteVol, 0) : '—'}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 rounded-md px-2 py-1 text-xs font-medium',
        active ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  )
}
