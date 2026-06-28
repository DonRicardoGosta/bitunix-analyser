import type Database from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id         TEXT PRIMARY KEY,
  enc        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  mode          TEXT NOT NULL,
  status        TEXT NOT NULL,
  config        TEXT NOT NULL,
  start_balance REAL NOT NULL,
  realized_pnl  REAL NOT NULL DEFAULT 0,
  peak_equity   REAL NOT NULL DEFAULT 0,
  close_reason  TEXT,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenges_created ON challenges(created_at);

CREATE TABLE IF NOT EXISTS positions (
  id                   TEXT PRIMARY KEY,
  challenge_id         TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  side                 TEXT NOT NULL,
  qty                  REAL NOT NULL,
  entry_price          REAL NOT NULL,
  leverage             REAL NOT NULL,
  margin               REAL NOT NULL,
  risk_level           INTEGER NOT NULL,
  strategy_id          TEXT NOT NULL,
  exchange_position_id TEXT,
  status               TEXT NOT NULL,
  close_price          REAL,
  realized_pnl         REAL,
  fee                  REAL NOT NULL DEFAULT 0,
  params_snapshot      TEXT,
  opened_at            INTEGER NOT NULL,
  closed_at            INTEGER,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_positions_challenge ON positions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(challenge_id, status);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  level        TEXT NOT NULL,
  category     TEXT NOT NULL,
  symbol       TEXT,
  message      TEXT NOT NULL,
  details      TEXT,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_challenge ON events(challenge_id, ts);
`

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA)
}
