#!/usr/bin/env node
import { runClaudeHookCli } from '@cli2voice/provider-claude';

runClaudeHookCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
