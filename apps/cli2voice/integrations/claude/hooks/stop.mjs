#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

async function readHookPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function extractLastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  const raw = await fs.readFile(transcriptPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  let lastText = '';

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.role !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
        lastText = item.text.trim();
      }
    }
  }

  return lastText;
}

const payload = await readHookPayload();
const sessionId = payload.session_id;
if (!sessionId) process.exit(0);

const message = await extractLastAssistantText(payload.transcript_path).catch(() => '');
if (!message) process.exit(0);

await new Promise((resolve, reject) => {
  const child = spawn('node', ['__CLAUDE2VOICE_APP_CLI__', 'final', '--session-id', sessionId, message], {
    stdio: 'ignore'
  });
  child.on('error', reject);
  child.on('close', () => resolve());
});
