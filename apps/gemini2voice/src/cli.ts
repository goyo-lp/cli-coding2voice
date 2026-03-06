#!/usr/bin/env node
import { runGeminiHookCli } from '@cli2voice/provider-gemini';

runGeminiHookCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
