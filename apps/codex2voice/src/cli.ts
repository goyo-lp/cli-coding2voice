#!/usr/bin/env node
import { runCodexWrapper } from '@cli2voice/provider-codex';
import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const client = new Cli2VoiceDaemonClient();

  if (!command || command === 'wrap' || command === 'run') {
    await runCodexWrapper(command ? rest : process.argv.slice(2));
    return;
  }

  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(await client.status(), null, 2)}\n`);
    return;
  }

  if (command === 'on' || command === 'off' || command === 'default') {
    const signal = command === 'on' ? 'manual_voice_on' : command === 'off' ? 'manual_voice_off' : 'manual_voice_default';
    process.stdout.write(
      `${JSON.stringify(await client.applySignal({ provider: 'codex', workspacePath: process.cwd(), signal }), null, 2)}\n`
    );
    return;
  }

  throw new Error('Unknown codex2voice command. Use wrap, status, on, off, or default.');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
