import { once } from 'node:events';
import { createDaemonServer } from './server.js';
import { readDaemonConfig } from './config.js';
import { Cli2VoiceRuntime } from './runtime.js';
import { Cli2VoiceStore } from './store.js';

export async function runDaemonCli(): Promise<void> {
  const config = await readDaemonConfig();
  const runtime = new Cli2VoiceRuntime(config, new Cli2VoiceStore(config.dbPath));
  await runtime.initialize();
  const server = createDaemonServer(runtime, config);
  let isShuttingDown = false;

  server.listen(config.port, config.host);
  await once(server, 'listening');
  process.stdout.write(`cli2voice daemon listening on http://${config.host}:${config.port}\n`);

  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    await runtime.stopPlayback().catch(() => undefined);
    runtime.close();
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}
