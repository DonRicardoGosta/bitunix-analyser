import type { RiskLevel } from '@shared/challenge/types'
import { useSetRisk } from './useChallengeData'
import { INPUT, RISK_LEVELS, RISK_META } from './shared'

// Inline per-coin risk editing applied to new decisions while running (item 9).
export function RiskLevelControl({
  challengeId,
  symbol,
  riskLevel,
}: {
  challengeId: string
  symbol: string
  riskLevel: RiskLevel
}) {
  const setRisk = useSetRisk()
  return (
    <select
      value={riskLevel}
      disabled={setRisk.isPending}
      onChange={(e) =>
        setRisk.mutate({ id: challengeId, symbol, riskLevel: Number(e.target.value) as RiskLevel })
      }
      className={INPUT + ' py-0.5 text-xs'}
      title="Applies to new decisions only"
    >
      {RISK_LEVELS.map((lvl) => (
        <option key={lvl} value={lvl}>
          {RISK_META[lvl].label}
        </option>
      ))}
    </select>
  )
}
