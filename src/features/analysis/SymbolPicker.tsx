import { useMemo, useRef, useState } from 'react'
import { useMarket } from '../../store/market'
import { useTickers } from '../../store/tickers'
import { fmtPrice, fmtPct, fmtCompact, pnlColor } from '../../lib/format'
import clsx from 'clsx'

export function SymbolPicker() {
  const symbol = useMarket((s) => s.symbol)
  const setSymbol = useMarket((s) => s.setSymbol)
  const map = useTickers((s) => s.map)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  const list = useMemo(() => {
    const arr = Object.values(map)
    const q = query.trim().toUpperCase()
    const filtered = q ? arr.filter((t) => t.symbol.includes(q)) : arr
    return filtered.sort((a, b) => b.quoteVol - a.quoteVol).slice(0, 40)
  }, [map, query])

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
        {symbol}
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-[#0c111b] shadow-xl">
            <div className="p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search symbol (e.g. BTC)"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-cyan-500"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {list.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-zinc-500">No symbols loaded yet…</div>
              )}
              {list.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => choose(t.symbol)}
                  className={clsx(
                    'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-zinc-800/60',
                    t.symbol === symbol && 'bg-cyan-500/10',
                  )}
                >
                  <span className="font-medium text-zinc-200">{t.symbol}</span>
                  <span className="flex items-center gap-3 tabular">
                    <span className="text-zinc-400">{fmtPrice(t.last)}</span>
                    <span className={clsx('w-16 text-right', pnlColor(t.changePct))}>
                      {fmtPct(t.changePct)}
                    </span>
                    <span className="w-14 text-right text-zinc-600">{fmtCompact(t.quoteVol, 0)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
