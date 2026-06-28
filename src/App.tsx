import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { AnalysisPage } from './features/analysis/AnalysisPage'
import { StatsPage } from './features/stats/StatsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { ChallengePage } from './features/challenge/ChallengePage'
import { ChallengeHistoryPage } from './features/challenge/ChallengeHistoryPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/analysis" replace />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/challenge" element={<ChallengePage />} />
        <Route path="/challenge/history" element={<ChallengeHistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/analysis" replace />} />
      </Route>
    </Routes>
  )
}
