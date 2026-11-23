import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './services/scanScheduler.js';

const { app, ctx } = createApp();
const { host, port } = ctx.cfg;

const server = app.listen(port, host, () => {
  const ai = ctx.cfg.ai.provider === 'none' ? 'not configured' : `${ctx.cfg.ai.provider}`;
  console.log(`\n  CyberDome Command Center`);
  console.log(`  ├─ URL:       http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`  ├─ Data dir:  ${ctx.cfg.dataDir}`);
  console.log(`  ├─ Schema:    v${ctx.db.schemaVersion()}`);
  console.log(`  ├─ AI:        ${ai}`);
  console.log(`  └─ Mode:      local single-user (no login); bound to ${host}\n`);
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')
    console.warn('  WARNING: bound to a non-loopback address. This app has no authentication; do not expose evidence to other networks.\n');
  startScheduler(ctx);
});

const shutdown = () => {
  stopScheduler();
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
