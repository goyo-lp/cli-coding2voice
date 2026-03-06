#!/usr/bin/env node
import { spawn } from 'node:child_process';

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
}
const payload = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
const sessionId = payload.session_id || process.env.GEMINI_SESSION_ID;
const workspace = payload.cwd || process.env.GEMINI_CWD || process.cwd();

if (!sessionId) {
  process.exit(0);
}

await new Promise((resolve, reject) => {
  const child = spawn('node', ['__GEMINI2VOICE_APP_CLI__', 'register', '--session-id', sessionId, '--workspace', workspace], {
    stdio: 'ignore'
  });
  child.on('error', reject);
  child.on('close', () => resolve());
});
