import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { connect, migrate } from '../server/db.ts';
import { issueContributionKey } from '../server/contributions.ts';
import { loadEnvFile } from 'node:process';
try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const [command, value, output] = process.argv.slice(2);
if (!['issue', 'revoke'].includes(command ?? '') || !value || (command === 'issue' && !output)) {
  console.error('issue <Pilot-Label> <neue-Schlüsseldatei> | revoke <Schlüssel-ID>');
  process.exit(1);
}
const db = connect(z.string().min(1).parse(process.env.DATABASE_URL));
try {
  await migrate(db);
  if (command === 'issue') {
    const issued = await issueContributionKey(db, value);
    try {
      await writeFile(resolve(output!), issued.key + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await db.query('UPDATE contribution_keys SET revoked_at=now() WHERE id=$1', [issued.id]);
      throw error;
    }
    console.log(
      `Schlüssel-ID: ${issued.id}. Schlüssel geschützt in der angegebenen Datei gespeichert; separat sicher übergeben.`,
    );
  } else {
    const result = await db.query(
      'UPDATE contribution_keys SET revoked_at=now() WHERE id=$1 RETURNING id',
      [z.uuid().parse(value)],
    );
    if (!result.rows.length) throw new Error('Unbekannte Schlüssel-ID.');
    console.log('Schlüssel widerrufen.');
  }
} catch {
  console.error('Schlüsseloperation fehlgeschlagen. Konfiguration und Zieldatei prüfen.');
  process.exitCode = 1;
} finally {
  await db.end();
}
