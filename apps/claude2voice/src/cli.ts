#!/usr/bin/env node
import { runClaudeHookCli, runClaudeWrapper } from '@cli2voice/provider-claude';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'wrap' || command === 'run') {
    await runClaudeWrapper(command ? rest : process.argv.slice(2));
    return;
  }

  await runClaudeHookCli(process.argv.slice(2));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
