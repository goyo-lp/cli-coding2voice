#!/usr/bin/env node
import { spawn } from 'node:child_process';

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
}
const payload = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
const sessionId = payload.session_id || process.env.GEMINI_SESSION_ID;
const message = typeof payload.prompt_response === 'string' ? payload.prompt_response.trim() : '';

if (!sessionId || !message) {
  process.exit(0);
}

await new Promise((resolve, reject) => {
  const child = spawn('node', ['__GEMINI2VOICE_APP_CLI__', 'final', '--session-id', sessionId, message], {
    stdio: 'ignore'
  });
  child.on('error', reject);
  child.on('close', () => resolve());
});
