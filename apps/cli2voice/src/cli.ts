#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMacosDictationHelperBuilt, getDictationStatus } from '@cli2voice/dictation-core';
import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';
import { runMcpCli } from '@cli2voice/mcp-server';
import type { SessionControlSignal } from '@cli2voice/voice-core';

function getFlag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] ?? fallback;
  return fallback;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function copyRecursive(sourceDir: string, destinationDir: string, replacements: Record<string, string>): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(sourcePath, destinationPath, replacements);
      continue;
    }
    const raw = await fs.readFile(sourcePath, 'utf8');
    const replaced = Object.entries(replacements).reduce(
      (content, [needle, value]) => content.split(needle).join(value),
      raw
    );
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, replaced, 'utf8');
    const sourceStat = await fs.stat(sourcePath);
    await fs.chmod(destinationPath, sourceStat.mode);
  }
}

async function installIntegration(name: 'codex' | 'claude' | 'gemini', destination?: string): Promise<void> {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(currentFile), '..');
  const monorepoRoot = path.resolve(packageRoot, '../..');
  const sourceDir = path.join(monorepoRoot, 'integrations', name);
  const defaultDestinations: Record<typeof name, string> = {
    codex: path.join(process.env.HOME ?? monorepoRoot, '.codex'),
    claude: path.join(process.env.HOME ?? monorepoRoot, '.claude', 'plugins', 'local', 'cli2voice'),
    gemini: path.join(process.env.HOME ?? monorepoRoot, '.gemini', 'extensions', 'cli2voice')
  };
  const targetDir = destination ?? defaultDestinations[name];

  await copyRecursive(sourceDir, targetDir, {
    '__CLI2VOICE_ROOT__': monorepoRoot,
    '__CLI2VOICE_APP_CLI__': path.join(monorepoRoot, 'apps', 'cli2voice', 'dist', 'cli.js'),
    '__CODEX2VOICE_APP_CLI__': path.join(monorepoRoot, 'apps', 'codex2voice', 'dist', 'cli.js'),
    '__CLAUDE2VOICE_APP_CLI__': path.join(monorepoRoot, 'apps', 'claude2voice', 'dist', 'cli.js'),
    '__GEMINI2VOICE_APP_CLI__': path.join(monorepoRoot, 'apps', 'gemini2voice', 'dist', 'cli.js')
  });

  process.stdout.write(`${targetDir}\n`);
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);
  const client = new Cli2VoiceDaemonClient();

  if (command === 'daemon' && subcommand === 'start') {
    const { runDaemonCli } = await import('@cli2voice/voice-daemon/daemon');
    await runDaemonCli();
    return;
  }

  if (command === 'mcp') {
    await runMcpCli();
    return;
  }

  if (command === 'status') {
    printJson(await client.status());
    return;
  }

  if (command === 'sessions') {
    printJson(await client.listSessions());
    return;
  }

  if (command === 'speak') {
    const text = [subcommand, ...rest].filter(Boolean).join(' ');
    printJson(await client.speak({ text, force: true, source: 'cli2voice.cli' }));
    return;
  }

  if (command === 'stop') {
    printJson(await client.stopPlayback());
    return;
  }

  if (command === 'session') {
    const signalMap: Record<string, SessionControlSignal> = {
      on: 'manual_voice_on',
      off: 'manual_voice_off',
      default: 'manual_voice_default',
      'plan-on': 'plan_enter',
      'plan-off': 'plan_exit'
    };
    const signal = signalMap[subcommand ?? ''];
    if (!signal) {
      throw new Error('Unknown session command. Use on, off, default, plan-on, or plan-off.');
    }
    const sessionId = getFlag(rest, '--session-id');
    const provider = getFlag(rest, '--provider');
    const workspacePath = getFlag(rest, '--workspace', process.cwd());
    printJson(await client.applySignal({ sessionId, provider, workspacePath, signal }));
    return;
  }

  if (command === 'config' && subcommand === 'get') {
    const { getConfigPath, readStoredConfig } = await import('@cli2voice/voice-daemon/config');
    printJson(await readStoredConfig(getConfigPath()));
    return;
  }

  if (command === 'config' && subcommand === 'set') {
    const { updateStoredConfig } = await import('@cli2voice/voice-daemon/config');
    const key = rest[0];
    const value = rest[1];
    if (!key || value === undefined) {
      throw new Error('Usage: cli2voice config set <key> <value>');
    }
    printJson(await updateStoredConfig(key, value));
    return;
  }

  if (command === 'dictation' && subcommand === 'status') {
    const { readDaemonConfig } = await import('@cli2voice/voice-daemon/config');
    const config = await readDaemonConfig();
    printJson(await getDictationStatus(config.dictation));
    return;
  }

  if (command === 'dictation' && subcommand === 'helper-build') {
    printJson({ helperPath: await ensureMacosDictationHelperBuilt(true) });
    return;
  }

  if (command === 'integration' && subcommand === 'install') {
    const name = rest[0] as 'codex' | 'claude' | 'gemini' | undefined;
    if (!name || !['codex', 'claude', 'gemini'].includes(name)) {
      throw new Error('Usage: cli2voice integration install <codex|claude|gemini> [destination]');
    }
    await installIntegration(name, rest[1]);
    return;
  }

  process.stdout.write(
    [
      'cli2voice commands:',
      '  daemon start',
      '  mcp',
      '  status',
      '  sessions',
      '  speak <text>',
      '  stop',
      '  session <on|off|default|plan-on|plan-off> [--session-id id] [--provider name] [--workspace path]',
      '  config get',
      '  config set <key> <value>',
      '  dictation status',
      '  dictation helper-build',
      '  integration install <codex|claude|gemini> [destination]'
    ].join('\n') + '\n'
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
