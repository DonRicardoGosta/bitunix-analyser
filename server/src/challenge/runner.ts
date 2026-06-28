import type {
  ChallengePosition,
  ChallengeRun,
  ChallengeRuntime,
  ChallengeSummary,
  CoinConfig,
  RiskLevel,
  RunStatus,
} from '@shared/challenge/types'
import type { Candle } from '@shared/market/candle'
import type { KlineInterval } from '@shared/market/intervals'
import { mergeCandle, parseKlines } from '../bitunix/candles'
import { marketFeed, type CandleEvent, type PriceEvent } from '../bitunix/marketFeed'
import { getKline } from '../bitunix/rest'
import { positionsRepo } from '../db/repos/positions'
import { challengesRepo } from '../db/repos/challenges'
import type { StoredPosition } from '../db/types'
import type { ChallengeLogger } from '../events/log'
import { grossPnl, type ExecutionEngine } from '../exec/types'
import { resolveStrategy } from '../strategy/registry'
import type { Decision, RiskParams, Strategy } from '../strategy/types'

interface CoinRuntime {
  config: CoinConfig
  strategy: Strategy
  interval: KlineInterval
  candles: Candle[]
  riskLevel: RiskLevel
  lastEntryAt: number
}

// ChallengeRunner drives one challenge: it seeds candle history, subscribes to
// the shared market feed, evaluates each coin's strategy on candle close,
// enforces fast TP/SL on price ticks, and runs the per-challenge risk manager
// (item 4): max loss -> Failed, profit target -> Success, manual -> Stopped,
// closing ONLY this challenge's positions.
export class ChallengeRunner {
  private readonly coins = new Map<string, CoinRuntime>()
  private readonly closing = new Set<string>()
  private unsubCandle?: () => void
  private unsubPrice?: () => void
  private riskTimer?: NodeJS.Timeout
  private peakEquity: number
  private terminal = false

  constructor(
    readonly run: ChallengeRun,
    private readonly engine: ExecutionEngine,
    private readonly log: ChallengeLogger,
    private readonly onTerminal: (run: ChallengeRun) => void,
  ) {
    this.peakEquity = run.peakEquity || run.startBalance
  }

  get id(): string {
    return this.run.id
  }

  async start(): Promise<void> {
    for (const coin of this.run.config.coins) {
      const strategy = resolveStrategy(coin.symbol, coin.strategyId)
      const interval = strategy.interval
      const rt: CoinRuntime = {
        config: coin,
        strategy,
        interval,
        candles: [],
        riskLevel: coin.riskLevel,
        lastEntryAt: 0,
      }
      this.coins.set(coin.symbol.toUpperCase(), rt)
      marketFeed.subscribeKline(coin.symbol, interval)
      try {
        const rows = await getKline({ symbol: coin.symbol, interval, limit: 200 })
        rt.candles = parseKlines(rows)
      } catch (err) {
        this.log.warn('system', coin.symbol, `history load failed: ${String(err)}`)
      }
    }
    this.unsubCandle = marketFeed.onCandle((e) => this.onCandle(e))
    this.unsubPrice = marketFeed.onPrice((e) => this.onPrice(e))
    this.riskTimer = setInterval(() => this.evaluateRisk(), 5000)
    this.log.system(`challenge started in ${this.engine.mode.toUpperCase()} mode`, {
      coins: this.run.config.coins.map((c) => c.symbol),
    })
  }

  private onCandle(e: CandleEvent): void {
    if (this.terminal) return
    const rt = this.coins.get(e.symbol.toUpperCase())
    if (!rt || e.interval !== rt.interval) return
    mergeCandle(rt.candles, e.candle)
    if (e.closed) void this.evaluateCoin(rt)
  }

  private onPrice(e: PriceEvent): void {
    if (this.terminal) return
    const rt = this.coins.get(e.symbol.toUpperCase())
    if (!rt) return
    void this.checkFastExit(rt, e.price)
    this.evaluateRisk()
  }

  private currentPosition(symbol: string): StoredPosition | undefined {
    return positionsRepo
      .listOpenByChallenge(this.id)
      .find((p) => p.symbol.toUpperCase() === symbol.toUpperCase())
  }

  private async evaluateCoin(rt: CoinRuntime): Promise<void> {
    if (this.terminal) return
    const symbol = rt.config.symbol
    const price = marketFeed.getPrice(symbol) ?? rt.candles.at(-1)?.close ?? 0
    if (!price) return
    const position = this.currentPosition(symbol)
    // Open positions keep their entry-time params (item 9); new entries use
    // the current risk level.
    const params: RiskParams = position
      ? (position.paramsSnapshot as RiskParams | undefined) ?? rt.strategy.resolveParams(rt.riskLevel)
      : rt.strategy.resolveParams(rt.riskLevel)

    const decision = rt.strategy.evaluate({
      symbol,
      interval: rt.interval,
      candles: rt.candles,
      price,
      riskLevel: rt.riskLevel,
      params,
      position,
      now: Date.now(),
    })

    this.log.signal(symbol, `decision: ${decision.action}`, {
      reasons: decision.reasons,
      confidence: decision.confidence,
      bias: decision.bias,
    })

    if (decision.action === 'open_long' || decision.action === 'open_short') {
      await this.tryOpen(rt, decision, price)
    } else if (decision.action === 'close' && position) {
      await this.closePosition(position, price, decision.reasons.join('; '))
    }
  }

  private async tryOpen(rt: CoinRuntime, decision: Decision, price: number): Promise<void> {
    const symbol = rt.config.symbol
    const params = rt.strategy.resolveParams(rt.riskLevel)
    if (Date.now() - rt.lastEntryAt < params.cooldownSec * 1000) {
      this.log.signal(symbol, `entry skipped: cooldown (${params.cooldownSec}s)`)
      return
    }
    const side = decision.action === 'open_long' ? 'LONG' : 'SHORT'
    const byMargin = (rt.config.marginAllocated * rt.config.leverage) / price
    const qty = Math.min(rt.config.orderQty, byMargin)
    if (!(qty > 0)) {
      this.log.warn('entry', symbol, 'computed order size <= 0')
      return
    }
    const snapshot = { ...params } as unknown as Record<string, unknown>
    const res = await this.engine.openPosition({
      symbol,
      side,
      qty,
      leverage: rt.config.leverage,
      price,
      riskLevel: rt.riskLevel,
      strategyId: rt.strategy.id,
      paramsSnapshot: snapshot,
    })
    if (res.ok && res.position) {
      rt.lastEntryAt = Date.now()
      this.log.entry(symbol, `opened ${side} ${qty} @ ~${price.toFixed(4)} (x${rt.config.leverage})`, {
        reasons: decision.reasons,
        confidence: decision.confidence,
      })
    } else {
      this.log.error('entry', symbol, `open failed: ${res.error ?? 'unknown'}`)
    }
  }

  private async checkFastExit(rt: CoinRuntime, price: number): Promise<void> {
    const position = this.currentPosition(rt.config.symbol)
    if (!position) return
    const params =
      (position.paramsSnapshot as RiskParams | undefined) ?? rt.strategy.resolveParams(rt.riskLevel)
    const dir = position.side === 'LONG' ? 1 : -1
    const pnlPct = ((price - position.entryPrice) / position.entryPrice) * position.leverage * dir * 100
    if (pnlPct >= params.takeProfitPct) {
      await this.closePosition(position, price, `take-profit ${pnlPct.toFixed(1)}%`)
    } else if (pnlPct <= -params.stopLossPct) {
      await this.closePosition(position, price, `stop-loss ${pnlPct.toFixed(1)}%`)
    }
  }

  private async closePosition(position: StoredPosition, price: number, reason: string): Promise<void> {
    if (this.closing.has(position.id)) return
    this.closing.add(position.id)
    try {
      const res = await this.engine.closePosition(position, price, reason)
      if (res.ok) {
        this.log.exit(
          position.symbol,
          `closed ${position.side} @ ~${(res.closePrice ?? price).toFixed(4)} (${reason})`,
          { realizedPnl: res.realizedPnl },
        )
        this.syncRealized()
      } else {
        this.log.error('exit', position.symbol, `close failed: ${res.error ?? 'unknown'}`)
      }
    } finally {
      this.closing.delete(position.id)
    }
  }

  private realizedPnl(): number {
    return positionsRepo
      .listByChallenge(this.id)
      .filter((p) => p.status === 'closed')
      .reduce((s, p) => s + (p.realizedPnl ?? 0), 0)
  }

  private syncRealized(): void {
    this.run.realizedPnl = this.realizedPnl()
    challengesRepo.update(this.id, { realizedPnl: this.run.realizedPnl, peakEquity: this.peakEquity })
  }

  private evaluateRisk(): void {
    if (this.terminal) return
    const realized = this.realizedPnl()
    const open = positionsRepo.listOpenByChallenge(this.id)
    let unreal = 0
    for (const p of open) {
      const price = marketFeed.getPrice(p.symbol)
      if (price) unreal += grossPnl(p.side, p.qty, p.entryPrice, price)
    }
    const equity = this.run.startBalance + realized + unreal
    if (equity > this.peakEquity) this.peakEquity = equity
    const target = this.run.startBalance * (1 + this.run.config.profitTargetPct / 100)
    const floor = this.run.startBalance * (1 - this.run.config.maxLossPct / 100)
    if (equity <= floor) {
      void this.finish('failed', `max loss reached (equity ${equity.toFixed(2)} <= ${floor.toFixed(2)})`)
    } else if (equity >= target) {
      void this.finish('success', `profit target reached (equity ${equity.toFixed(2)} >= ${target.toFixed(2)})`)
    }
  }

  /** Manual stop (item: stop a running challenge). */
  async stop(): Promise<void> {
    await this.finish('stopped', 'manually stopped')
  }

  /** Change a coin's risk level; applies to new decisions only (item 9). */
  setRiskLevel(symbol: string, level: RiskLevel): boolean {
    const rt = this.coins.get(symbol.toUpperCase())
    if (!rt) return false
    rt.riskLevel = level
    // Persist into the stored config so it survives restart.
    const idx = this.run.config.coins.findIndex((c) => c.symbol.toUpperCase() === symbol.toUpperCase())
    if (idx >= 0) this.run.config.coins[idx].riskLevel = level
    challengesRepo.update(this.id, { config: this.run.config })
    this.log.risk(symbol, `risk level set to ${level} (applies to new decisions)`)
    return true
  }

  private async finish(status: RunStatus, reason: string): Promise<void> {
    if (this.terminal) return
    this.terminal = true
    if (this.riskTimer) clearInterval(this.riskTimer)
    this.log.risk(undefined, `challenge ${status.toUpperCase()}: ${reason}`)

    // Close only THIS challenge's open positions (item 4).
    const open = positionsRepo.listOpenByChallenge(this.id)
    for (const p of open) {
      const price = marketFeed.getPrice(p.symbol) ?? p.entryPrice
      try {
        const res = await this.engine.closePosition(p, price, `challenge ${status}`)
        if (res.ok) this.log.exit(p.symbol, `closed on ${status}`, { realizedPnl: res.realizedPnl })
      } catch (err) {
        this.log.error('exit', p.symbol, `close on ${status} failed: ${String(err)}`)
      }
    }

    this.unsubCandle?.()
    this.unsubPrice?.()
    for (const rt of this.coins.values()) marketFeed.unsubscribeKline(rt.config.symbol, rt.interval)

    const realized = this.realizedPnl()
    this.run.realizedPnl = realized
    this.run.status = status
    this.run.endedAt = Date.now()
    this.run.closeReason = reason
    challengesRepo.update(this.id, {
      status,
      realizedPnl: realized,
      peakEquity: this.peakEquity,
      endedAt: this.run.endedAt,
      closeReason: reason,
    })
    this.onTerminal(this.run)
  }

  getSummary(): ChallengeSummary {
    const open = positionsRepo.listOpenByChallenge(this.id)
    const positions: ChallengePosition[] = open.map((p) => {
      const price = marketFeed.getPrice(p.symbol) ?? p.entryPrice
      const unrealizedPnl = grossPnl(p.side, p.qty, p.entryPrice, price)
      const rt = this.coins.get(p.symbol.toUpperCase())
      return {
        id: p.id,
        challengeId: this.id,
        symbol: p.symbol,
        side: p.side,
        qty: p.qty,
        entryPrice: p.entryPrice,
        leverage: p.leverage,
        margin: p.margin,
        markPrice: price,
        unrealizedPnl,
        riskLevel: rt?.riskLevel ?? p.riskLevel,
        strategyId: p.strategyId,
        openedAt: p.openedAt,
      }
    })
    const realized = this.realizedPnl()
    const unreal = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
    const equity = this.run.startBalance + realized + unreal
    const usedMargin = open.reduce((s, p) => s + p.margin, 0)
    const runtime: ChallengeRuntime = {
      realizedPnl: realized,
      unrealizedPnl: unreal,
      equity,
      usedMargin,
      openPositions: open.length,
    }
    const run: ChallengeRun = {
      ...this.run,
      realizedPnl: realized,
      unrealizedPnl: unreal,
      equity,
      peakEquity: this.peakEquity,
      resultPnl: realized + unreal,
    }
    return { run, runtime, positions }
  }
}
