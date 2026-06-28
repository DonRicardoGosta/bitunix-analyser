import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { config } from '../config'
import { logger } from '../logger'
import { runMigrations } from './migrate'

let db: Database.Database | null = null

/** Lazily opens (and migrates) the SQLite database in the data directory. */
export function getDb(): Database.Database {
  if (db) return db
  mkdirSync(config.dataDir, { recursive: true })
  const file = join(config.dataDir, 'challenge.db')
  const handle = new Database(file)
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  runMigrations(handle)
  db = handle
  logger.info(`SQLite ready at ${file}`)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
