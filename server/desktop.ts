import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './services/scanScheduler.js';

/**
 * Entry point used by the desktop (Electron) shell. Starts the same Express app on loopback,
 * preferring the usual port and falling back to a free one, and runs the scan scheduler.
 */
export async function startDesktopServer(preferredPort = 4646): Promise<{ url: string; dataDir: string; close: () => Promise<void> }> {
  const { app, ctx } = createApp();
  const listen = (port: number) =>
    new Promise<Server>((resolve, reject) => {
      const srv = app.listen(port, '127.0.0.1');
      srv.once('listening', () => resolve(srv));
      srv.once('error', reject);
    });
  let server: Server;
  try {
    server = await listen(preferredPort);
  } catch {
    server = await listen(0);
  }
  const { port } = server.address() as AddressInfo;
  startScheduler(ctx);
  return {
    url: `http://127.0.0.1:${port}`,
    dataDir: ctx.cfg.dataDir,
    close: () =>
      new Promise((resolve) => {
        stopScheduler();
        server.close(() => {
          ctx.db.close();
          resolve();
        });
        setTimeout(resolve, 2000).unref();
      }),
  };
}
