import { getDb } from '../index'

const SINGLETON_ID = 'default'

export const credentialsRepo = {
  /** Persist the encrypted credentials blob (overwrites the singleton row). */
  save(enc: string): void {
    getDb()
      .prepare(
        `INSERT INTO credentials(id, enc, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at`,
      )
      .run(SINGLETON_ID, enc, Date.now())
  },
  load(): string | undefined {
    const row = getDb()
      .prepare('SELECT enc FROM credentials WHERE id = ?')
      .get(SINGLETON_ID) as { enc: string } | undefined
    return row?.enc
  },
  clear(): void {
    getDb().prepare('DELETE FROM credentials WHERE id = ?').run(SINGLETON_ID)
  },
}
