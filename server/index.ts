import { connect, migrate } from './db.ts';
import { getConfig } from './config.ts';
import { buildApp } from './app.ts';
const config = getConfig(),
  db = connect(config.DATABASE_URL);
await migrate(db);
const app = await buildApp(db, config);
await app.listen({ host: config.HOST, port: config.PORT });
console.log(`API bereit auf Port ${config.PORT}.`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void app
      .close()
      .then(() => db.end())
      .then(() => process.exit(0));
  });
