import http from 'node:http';
import { URL } from 'node:url';
import type { PublishActionsInput, RegisterSessionInput, SessionOverrideInput, SpeakNowInput } from '@cli2voice/voice-core';
import type { ResolvedDaemonConfig } from './config.js';
import { Cli2VoiceRuntime } from './runtime.js';

async function readJson<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function createDaemonServer(runtime: Cli2VoiceRuntime, config: ResolvedDaemonConfig): http.Server {
  return http.createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET';
      const url = new URL(request.url ?? '/', `http://${config.host}:${config.port}`);
      const segments = url.pathname.split('/').filter(Boolean);

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === 'GET' && url.pathname === '/status') {
        sendJson(response, 200, runtime.getStatus());
        return;
      }

      if (method === 'GET' && url.pathname === '/config') {
        sendJson(response, 200, runtime.getStatus());
        return;
      }

      if (method === 'GET' && url.pathname === '/sessions') {
        sendJson(response, 200, runtime.listSessions());
        return;
      }

      if (method === 'GET' && segments[0] === 'sessions' && segments.length === 2) {
        const session = runtime.getSession(segments[1] as string);
        if (!session) {
          sendJson(response, 404, { error: 'Session not found.' });
          return;
        }
        sendJson(response, 200, session);
        return;
      }

      if (method === 'POST' && url.pathname === '/sessions/register') {
        const body = await readJson<RegisterSessionInput>(request);
        sendJson(response, 200, runtime.registerSession(body));
        return;
      }

      if (method === 'POST' && segments[0] === 'sessions' && segments[2] === 'actions') {
        const body = await readJson<PublishActionsInput>(request);
        sendJson(response, 200, await runtime.publishActions({ sessionId: segments[1] as string }, body));
        return;
      }

      if (method === 'POST' && segments[0] === 'sessions' && segments[2] === 'control') {
        const body = await readJson<Omit<SessionOverrideInput, 'sessionId'>>(request);
        sendJson(response, 200, runtime.applySignal({ ...body, sessionId: segments[1] as string }));
        return;
      }

      if (method === 'POST' && url.pathname === '/sessions/control') {
        const body = await readJson<SessionOverrideInput>(request);
        sendJson(response, 200, runtime.applySignal(body));
        return;
      }

      if (method === 'POST' && url.pathname === '/speak') {
        const body = await readJson<SpeakNowInput>(request);
        sendJson(response, 200, await runtime.speakNow(body));
        return;
      }

      if (method === 'POST' && url.pathname === '/playback/stop') {
        sendJson(response, 200, { stopped: await runtime.stopPlayback() });
        return;
      }

      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
