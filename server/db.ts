import pg from 'pg';
import { readFile } from 'node:fs/promises';
export type Db = Pick<pg.Pool, 'query' | 'connect'>;
export function connect(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  pool.on('error', () =>
    console.error('PostgreSQL-Verbindung unterbrochen; Neuverbindung bei der nächsten Anfrage.'),
  );
  return pool;
}
export async function migrate(db: Db) {
  await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
