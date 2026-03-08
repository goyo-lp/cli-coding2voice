#!/usr/bin/env node
import { runGeminiHookCli, runGeminiWrapper } from '@cli2voice/provider-gemini';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'wrap' || command === 'run') {
    await runGeminiWrapper(command ? rest : process.argv.slice(2));
    return;
  }

  await runGeminiHookCli(process.argv.slice(2));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
