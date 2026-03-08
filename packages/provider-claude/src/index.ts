import { randomUUID } from 'node:crypto';
import { runWrappedCli } from '@cli2voice/dictation-core';
import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';
import { readDaemonConfig } from '@cli2voice/voice-daemon/config';
import type { SessionControlSignal } from '@cli2voice/voice-core';

async function readMessage(argv: string[]): Promise<string> {
  if (argv.length > 0) return argv.join(' ');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function getFlag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] ?? fallback;
  return fallback;
}

function requireFlag(args: string[], name: string, fallback?: string): string {
  const value = getFlag(args, name, fallback);
  if (!value) throw new Error(`Missing required flag ${name}`);
  return value;
}

export async function runClaudeHookCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const client = new Cli2VoiceDaemonClient();

  if (command === 'register') {
    const sessionId = getFlag(rest, '--session-id') ?? `claude-${process.pid}-${randomUUID()}`;
    const workspacePath = getFlag(rest, '--workspace', process.cwd()) as string;
    const session = await client.registerSession({ sessionId, provider: 'claude', workspacePath });
    process.stdout.write(`${session.sessionId}\n`);
    return;
  }

  if (command === 'final') {
    const sessionId = requireFlag(rest, '--session-id');
    const message = await readMessage(rest.filter((value, index, list) => list[index - 1] !== '--session-id' && value !== sessionId));
    await client.publishActions({ sessionId }, { actions: [{ kind: 'candidate', message, source: 'claude.hook.final' }] });
    return;
  }

  if (command === 'signal') {
    const signal = requireFlag(rest, '--signal') as SessionControlSignal;
    const sessionId = getFlag(rest, '--session-id');
    const workspacePath = getFlag(rest, '--workspace');
    await client.applySignal({ sessionId, provider: sessionId ? undefined : 'claude', workspacePath, signal });
    return;
  }

  throw new Error('Unknown claude provider command. Use register, final, or signal.');
}

export async function runClaudeWrapper(argv: string[]): Promise<void> {
  const config = await readDaemonConfig();
  await runWrappedCli({
    command: 'claude',
    args: argv,
    dictation: config.dictation
  });
}
