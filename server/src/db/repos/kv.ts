import { getDb } from '../index'

export const kvRepo = {
  get(key: string): string | undefined {
    const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value
  },
  set(key: string, value: string): void {
    getDb()
      .prepare(
        'INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  },
}
