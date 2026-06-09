import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFundingRate } from '../../lib/bitunix/rest'
import { toNum, fmtDuration } from '../../lib/format'
import clsx from 'clsx'

export function FundingWidget({ symbol }: { symbol: string }) {
  const { data } = useQuery({
    queryKey: ['funding', symbol],
    queryFn: () => getFundingRate(symbol),
    refetchInterval: 30_000,
    retry: 0,
  })

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!data) return null

  const rate = toNum(data.fundingRate) * 100
  const next = toNum(data.nextFundingTime)
  const countdown = next > now ? next - now : 0
  const tone = rate > 0 ? 'text-emerald-400' : rate < 0 ? 'text-rose-400' : 'text-zinc-300'

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Funding</div>
        <div className={clsx('tabular font-semibold', tone)}>{rate.toFixed(4)}%</div>
      </div>
      <div className="h-7 w-px bg-zinc-800" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Next in</div>
        <div className="tabular text-zinc-300">{fmtDuration(countdown)}</div>
      </div>
    </div>
  )
}
