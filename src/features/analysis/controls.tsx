import clsx from 'clsx'

export const WINDOW_OPTIONS = [0.5, 1, 2, 5]

export function WindowSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
      <span className="px-1.5 text-[11px] text-zinc-500">±</span>
      {WINDOW_OPTIONS.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={clsx(
            'rounded-md px-2 py-0.5 text-[11px] font-medium',
            value === w ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200',
          )}
        >
          {w}%
        </button>
      ))}
    </div>
  )
}

/** Friendly note shown when Binance public data can't be reached. */
export function BinanceNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  const restricted = /restricted location|Service unavailable|451|eligibility/i.test(msg)
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
      {restricted ? (
        <>
          Binance public data is not available from this network location. These panels (liquidity,
          liquidations, open interest, long/short) need access to <code>fapi.binance.com</code>. Run the
          app from a non-restricted location/VPN.
        </>
      ) : (
        <>Could not load Binance data: {msg}</>
      )}
    </div>
  )
}
