import type { KlineInterval } from '../../../lib/bitunix/rest'
import { useMarket } from '../../../store/market'
import { useUiPrefs, type TpMode, type TradeMode } from '../../../store/uiPrefs'

// ---------------------------------------------------------------------------
// "Best setup" — a one-click, high-win-rate preset for single-direction trading.
//
// Opening side (analysis + ticket): a higher, cleaner timeframe with HTF trend
// confirmation, one-sided trades, and a nearer take-profit so targets are hit
// more often. Closing side (position review): one notch faster than the entry
// timeframe so reversals are flagged earlier. All values are persisted store
// fields, so applying the preset is global regardless of which page triggers it.
// ---------------------------------------------------------------------------

export const BEST_SETUP = {
  interval: '4h' as KlineInterval, // analysis / entry timeframe (clean trends, HTF-backed)
  tradeMode: 'single' as TradeMode, // one-sided LONG/SHORT, not the range straddle
  tpMode: 'TP1' as TpMode, // nearer target => higher realized win rate
  reviewInterval: '1h' as KlineInterval, // faster TF to review/close open positions
} as const

/** Applies the high-win-rate preset to both the opening and closing sides. */
export function applyBestSetup(): void {
  useMarket.getState().setInterval(BEST_SETUP.interval)
  useUiPrefs.getState().setTicket({
    ticketTradeMode: BEST_SETUP.tradeMode,
    ticketTpMode: BEST_SETUP.tpMode,
  })
  useUiPrefs.getState().setStats({ statsReviewInterval: BEST_SETUP.reviewInterval })
}

/** True when every field already matches the preset (for an "active" button state). */
export function isBestSetupActive(s: {
  interval: KlineInterval
  tradeMode: TradeMode
  tpMode: TpMode
  reviewInterval: KlineInterval
}): boolean {
  return (
    s.interval === BEST_SETUP.interval &&
    s.tradeMode === BEST_SETUP.tradeMode &&
    s.tpMode === BEST_SETUP.tpMode &&
    s.reviewInterval === BEST_SETUP.reviewInterval
  )
}
