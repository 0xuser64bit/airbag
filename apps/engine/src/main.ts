// The Airbag engine process. Configuration: .env.example and apps/engine/src/config.ts.

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const cfg = loadConfig();
const app = await buildApp(cfg);
app.start();
app.api.listen(cfg.port, cfg.host, () => {
  app.log.info('api.listen', { host: cfg.host, port: cfg.port, origins: cfg.webOrigins });
});

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info('engine.stop', { signal });
  const force = setTimeout(() => process.exit(1), 10_000);
  try {
    await app.stop();
  } catch (err) {
    app.log.error('engine.stop.error', { err });
    process.exitCode = 1;
  }
  clearTimeout(force);
  process.exit(process.exitCode ?? 0);
};
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
process.on('unhandledRejection', (err) => {
  app.log.error('unhandled.rejection', { err });
  process.exitCode = 1;
  void stop('unhandledRejection');
});
app.api.on('error', (err) => {
  app.log.error('api.listen.error', { err });
  process.exitCode = 1;
  void stop('listenError');
});
