import { connect, migrate } from './db.ts';
const db = connect(process.env.DATABASE_URL ?? '');
try {
  await migrate(db);
  console.log('Datenbankschema aktualisiert.');
} finally {
  await db.end();
}
