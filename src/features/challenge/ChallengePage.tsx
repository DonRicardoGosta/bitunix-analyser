import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useChallengeStream } from '../../lib/challenge/socket'
import { Panel, EmptyState, ConnectionDot } from '../../components/ui/primitives'
import { ChallengeBuilder } from './ChallengeBuilder'
import { ChallengeCard } from './ChallengeCard'
import { EventLog } from './EventLog'

export function ChallengePage() {
  const stream = useChallengeStream()

  const running = useMemo(
    () =>
      Object.values(stream.summaries)
        .filter((s) => s.run.status === 'running')
        .sort((a, b) => b.run.startedAt - a.run.startedAt),
    [stream.summaries],
  )

  const nameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of stream.runs) map[r.id] = r.config.name
    for (const s of Object.values(stream.summaries)) map[s.run.id] = s.run.config.name
    return map
  }, [stream.runs, stream.summaries])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Challenge engine</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Automated multi-coin trading challenges run by the backend service.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionDot connected={stream.connected} />
          <Link
            to="/challenge/history"
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            History
          </Link>
        </div>
      </div>

      <ChallengeBuilder />

      <Panel title="Running challenges" subtitle={`${running.length} active`}>
        {running.length === 0 ? (
          <EmptyState
            title="No running challenges"
            hint="Configure coins above and start a paper or live challenge."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {running.map((s) => (
              <ChallengeCard key={s.run.id} summary={s} />
            ))}
          </div>
        )}
      </Panel>

      <EventLog events={stream.events} nameById={nameById} />
    </div>
  )
}
