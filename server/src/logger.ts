import { config } from './config'

type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const threshold = ORDER[(config.logLevel as Level)] ?? ORDER.info

function emit(level: Level, msg: string, ...args: unknown[]): void {
  if (ORDER[level] < threshold) return
  const ts = new Date().toISOString()
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => emit('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => emit('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => emit('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => emit('error', msg, ...args),
}

export type Logger = typeof logger
