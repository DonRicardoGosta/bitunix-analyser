import { randomUUID } from 'node:crypto'
import type {
  AccountBalanceResponse,
  ChallengeConfig,
  ChallengeConfigInput,
  ChallengeRun,
  ChallengeSummary,
  CredentialsPayload,
  RiskLevel,
  ValidateConfigResult,
  ValidationError,
} from '@shared/challenge/types'
import { toNum } from '@shared/num'
import { BitunixRest } from '../bitunix/rest'
import { config as appConfig } from '../config'
import { challengesRepo } from '../db/repos/challenges'
import { credentialsRepo } from '../db/repos/credentials'
import { decryptJson, encryptJson } from '../crypto'
import { emitEvent, makeChallengeLogger } from '../events/log'
import { LiveExecutionEngine } from '../exec/liveEngine'
import { PaperExecutionEngine } from '../exec/paperEngine'
import type { ExecContext, ExecutionEngine } from '../exec/types'
import { logger } from '../logger'
import { initStrategies } from '../strategy'
import { validateConfig } from './capital'
import { ChallengeRunner } from './runner'

export class ChallengeManagerError extends Error {
  readonly errors?: ValidationError[]
  constructor(message: string, errors?: ValidationError[]) {
    super(message)
    this.name = 'ChallengeManagerError'
    this.errors = errors
  }
}

class ChallengeManager {
  private readonly runners = new Map<string, ChallengeRunner>()
  private rest: BitunixRest | null = null

  init(): void {
    initStrategies()
    this.loadCredentials()
    this.resume()
  }

  // ---- Credentials ----

  private loadCredentials(): void {
    const blob = credentialsRepo.load()
    if (!blob) return
    try {
      const payload = decryptJson<CredentialsPayload>(blob)
      this.rest = new BitunixRest({ ...payload, marginCoin: payload.marginCoin ?? appConfig.marginCoin })
      logger.info('loaded stored Bitunix credentials')
    } catch (err) {
      logger.error(`failed to decrypt credentials: ${String(err)}`)
    }
  }

  setCredentials(payload: CredentialsPayload): void {
    credentialsRepo.save(encryptJson(payload))
    this.rest = new BitunixRest({ ...payload, marginCoin: payload.marginCoin ?? appConfig.marginCoin })
  }

  hasCredentials(): boolean {
    return this.rest !== null
  }

  async getAccountBalance(): Promise<AccountBalanceResponse> {
    if (!this.rest) throw new ChallengeManagerError('No Bitunix credentials set')
    const accts = await this.rest.getAccount()
    const a = Array.isArray(accts) ? accts[0] : accts
    const available = toNum(a?.available)
    const margin = toNum(a?.margin)
    const upnl = toNum(a?.crossUnrealizedPNL) + toNum(a?.isolationUnrealizedPNL)
    return { available, equity: available + margin + upnl, marginCoin: this.rest.marginCoin }
  }

  private async availableFor(configInput: ChallengeConfigInput): Promise<number> {
    if (configInput.mode === 'paper') return configInput.startBalance
    const bal = await this.getAccountBalance()
    return bal.available
  }

  // ---- Validation ----

  async validate(configInput: ChallengeConfigInput): Promise<ValidateConfigResult> {
    const available = await this.availableFor(configInput)
    return validateConfig(configInput, available)
  }

  // ---- Lifecycle ----

  async create(configInput: ChallengeConfigInput): Promise<ChallengeRun> {
    initStrategies()
    if (configInput.mode === 'live' && !this.rest) {
      throw new ChallengeManagerError('Live trading requires Bitunix credentials')
    }
    const available = await this.availableFor(configInput)
    const validation = await validateConfig(configInput, available)
    if (!validation.ok) {
      throw new ChallengeManagerError('Invalid challenge configuration', validation.errors)
    }

    const config: ChallengeConfig = { ...configInput, id: randomUUID(), createdAt: Date.now() }
    const run: ChallengeRun = {
      id: config.id,
      config,
      status: 'running',
      startedAt: Date.now(),
      startBalance: config.startBalance,
      realizedPnl: 0,
      unrealizedPnl: 0,
      equity: config.startBalance,
      peakEquity: config.startBalance,
      resultPnl: 0,
    }
    challengesRepo.insert(run)
    await this.launch(run)
    return run
  }

  private async launch(run: ChallengeRun): Promise<void> {
    const log = makeChallengeLogger(run.id)
    const ctx: ExecContext = {
      emitApi: (symbol, message, details) =>
        void emitEvent(run.id, { category: 'api', symbol, message, details }),
      emitError: (symbol, message, details) =>
        void emitEvent(run.id, { level: 'error', category: 'api', symbol, message, details }),
    }

    let engine: ExecutionEngine
    if (run.config.mode === 'live') {
      if (!this.rest) throw new ChallengeManagerError('Live trading requires Bitunix credentials')
      engine = new LiveExecutionEngine(run.id, this.rest, ctx)
    } else {
      engine = new PaperExecutionEngine(run.id, run.startBalance, ctx)
    }

    const runner = new ChallengeRunner(run, engine, log, (r) => this.onTerminal(r))
    this.runners.set(run.id, runner)
    await runner.start()
  }

  private onTerminal(run: ChallengeRun): void {
    this.runners.delete(run.id)
  }

  async stop(id: string): Promise<boolean> {
    const runner = this.runners.get(id)
    if (!runner) return false
    await runner.stop()
    return true
  }

  setRiskLevel(id: string, symbol: string, level: RiskLevel): boolean {
    const runner = this.runners.get(id)
    if (!runner) return false
    return runner.setRiskLevel(symbol, level)
  }

  // ---- Snapshots ----

  getSummaries(): ChallengeSummary[] {
    return [...this.runners.values()].map((r) => r.getSummary())
  }

  getSummary(id: string): ChallengeSummary | undefined {
    return this.runners.get(id)?.getSummary()
  }

  isRunning(id: string): boolean {
    return this.runners.has(id)
  }

  // ---- Resume on boot ----

  private resume(): void {
    const running = challengesRepo.listByStatus('running')
    let resumed = 0
    for (const run of running) {
      if (run.config.mode === 'live' && !this.rest) {
        challengesRepo.update(run.id, {
          status: 'stopped',
          closeReason: 'backend restarted without credentials',
          endedAt: Date.now(),
        })
        continue
      }
      resumed += 1
      this.launch(run).catch((err) => logger.error(`resume failed for ${run.id}: ${String(err)}`))
    }
    if (resumed) logger.info(`resumed ${resumed} running challenge(s)`)
  }
}

export const challengeManager = new ChallengeManager()
