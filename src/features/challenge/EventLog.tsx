import { useMemo, useState } from 'react'
import type { ChallengeEvent, EventCategory } from '@shared/challenge/types'
import { fmtClock } from '../../lib/format'
import { Panel, EmptyState } from '../../components/ui/primitives'
import { CATEGORY_TONE, LEVEL_TONE } from './shared'

const CATEGORIES: EventCategory[] = ['entry', 'exit', 'risk', 'signal', 'api', 'system']

// Colour a row by the decision/action expressed in the message + level, so the
// log reads at a glance: green = open, cyan = close, dim = hold/skip, etc.
function messageTone(e: ChallengeEvent): string {
  if (e.level === 'error') return 'text-rose-400'
  if (e.level === 'warn') return 'text-amber-400'
  const m = e.message.toLowerCase()
  if (m.includes('skip') || m.includes('hold') || m.includes('cooldown')) return 'text-zinc-500'
  if (m.includes('open') || m.includes('enter')) return 'text-emerald-300'
  if (m.includes('close') || m.includes('take-profit') || m.includes('stop-loss')) return 'text-cyan-300'
  return LEVEL_TONE[e.level]
}

function detailEntries(details?: Record<string, unknown>): [string, unknown][] {
  if (!details) return []
  return Object.entries(details).filter(([k]) => k !== 'reasons')
}

function fmtVal(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, '')
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (v === null || v === undefined) return '—'
  return String(v)
}

function EventRow({ e, name }: { e: ChallengeEvent; name?: string }) {
  const [open, setOpen] = useState(false)
  const reasons = Array.isArray(e.details?.reasons) ? (e.details.reasons as string[]) : []
  const meta = detailEntries(e.details)
  const hasDetail = reasons.length > 0 || meta.length > 0

  return (
    <div className="border-b border-zinc-900">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={
          'flex w-full items-start gap-2 py-1 text-left ' +
          (hasDetail ? 'cursor-pointer hover:bg-zinc-800/30' : 'cursor-default')
        }
      >
        <span className="w-4 shrink-0 text-zinc-700">{hasDetail ? (open ? '▾' : '▸') : ''}</span>
        <span className="shrink-0 text-zinc-600">{fmtClock(e.ts)}</span>
        <span className={'shrink-0 uppercase ' + CATEGORY_TONE[e.category]}>{e.category}</span>
        {e.symbol && <span className="shrink-0 text-zinc-400">{e.symbol}</span>}
        <span className={'min-w-0 flex-1 ' + messageTone(e)}>
          {e.message}
          {name && <span className="ml-2 text-zinc-700">· {name}</span>}
        </span>
      </button>

      {open && hasDetail && (
        <div className="mb-1 ml-10 mr-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          {reasons.length > 0 && (
            <ul className="mb-2 list-disc pl-4 text-zinc-300">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {meta.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-500">
              {meta.map(([k, v]) => (
                <span key={k}>
                  {k}: <span className="text-zinc-300">{fmtVal(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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
    return list.slice(-400).reverse()
  }, [events, category, symbol])

  return (
    <Panel
      title="Event log"
      subtitle="Live backend decisions, triggers, API calls and errors — click a row for full reasons"
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
            <EventRow key={e.id} e={e} name={nameById[e.challengeId]} />
          ))}
        </div>
      )}
    </Panel>
  )
}
