// Technical indicators now live in shared/ so the SPA and the Challenge backend
// share a single implementation. Re-exported here to preserve existing import
// paths (`../lib/indicators`). The shared `Candle` shape is structurally
// identical to the SPA's, so existing callers continue to work unchanged.
export * from '@shared/indicators'
export type { MacdResult, BollingerResult, StochRsiResult } from '@shared/indicators'
