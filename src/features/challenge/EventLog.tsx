import { useMemo, useState } from 'react'
import type { ChallengeEvent, EventCategory } from '@shared/challenge/types'
import { fmtClock } from '../../lib/format'
import { Panel, EmptyState } from '../../components/ui/primitives'
import { CATEGORY_TONE, LEVEL_TONE } from './shared'

const CATEGORIES: EventCategory[] = ['entry', 'exit', 'risk', 'signal', 'api', 'system']

// Real-time event log with category/coin filtering (item 8). `nameById` maps a
// challenge id to its display name for context.
export function EventLog({
  events,
  nameById,
}: {
  events: ChallengeEvent[]
  nameById: Record<string, string>
}) {
  const [category, setCategory] = useState<EventCategory | 'all'>('all')
  const [symbol, setSymbol] = useState<string>('all')

  const symbols = useMemo(() => {
    const set = new Set<string>()
    for (const e of events) if (e.symbol) set.add(e.symbol)
    return [...set].sort()
  }, [events])

  const filtered = useMemo(() => {
    const list = events.filter(
      (e) =>
        (category === 'all' || e.category === category) &&
        (symbol === 'all' || e.symbol === symbol),
    )
    return list.slice(-300).reverse()
  }, [events, category, symbol])

  return (
    <Panel
      title="Event log"
      subtitle="Live backend decisions, triggers, API calls and errors"
      actions={
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as EventCategory | 'all')}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="all">All coins</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {filtered.length === 0 ? (
        <EmptyState title="No events yet" hint="Backend activity will stream here in real time." />
      ) : (
        <div className="max-h-[28rem] overflow-y-auto font-mono text-xs leading-relaxed">
          {filtered.map((e) => (
            <div key={e.id} className="flex gap-2 border-b border-zinc-900 py-1">
              <span className="shrink-0 text-zinc-600">{fmtClock(e.ts)}</span>
              <span className={'shrink-0 uppercase ' + CATEGORY_TONE[e.category]}>{e.category}</span>
              {e.symbol && <span className="shrink-0 text-zinc-400">{e.symbol}</span>}
              <span className={'min-w-0 flex-1 ' + LEVEL_TONE[e.level]}>
                {e.message}
                {nameById[e.challengeId] && (
                  <span className="ml-2 text-zinc-700">· {nameById[e.challengeId]}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
