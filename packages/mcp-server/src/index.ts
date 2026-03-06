import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export async function runMcpCli(): Promise<void> {
  const client = new Cli2VoiceDaemonClient();
  const server = new McpServer({ name: 'cli2voice', version: '0.1.0' });

  server.registerTool('voice_status', {
    title: 'Voice Status',
    description: 'Return cli2voice daemon status and active playback information.',
    inputSchema: {}
  }, async () => textResult(await client.status()));

  server.registerTool('voice_sessions', {
    title: 'Voice Sessions',
    description: 'List tracked agent sessions.',
    inputSchema: {}
  }, async () => textResult(await client.listSessions()));

  server.registerTool('voice_override', {
    title: 'Voice Override',
    description: 'Set a session voice override to on, off, or default. Select by sessionId or by provider/workspace.',
    inputSchema: {
      sessionId: z.string().optional(),
      provider: z.string().optional(),
      workspacePath: z.string().optional(),
      mode: z.enum(['on', 'off', 'default'])
    }
  }, async ({ sessionId, provider, workspacePath, mode }) => {
    const signal = mode === 'on' ? 'manual_voice_on' : mode === 'off' ? 'manual_voice_off' : 'manual_voice_default';
    return textResult(await client.applySignal({ sessionId, provider, workspacePath, signal }));
  });

  server.registerTool('voice_plan_mode', {
    title: 'Voice Plan Mode',
    description: 'Toggle plan mode for a tracked session.',
    inputSchema: {
      sessionId: z.string().optional(),
      provider: z.string().optional(),
      workspacePath: z.string().optional(),
      enabled: z.boolean()
    }
  }, async ({ sessionId, provider, workspacePath, enabled }) => {
    return textResult(await client.applySignal({
      sessionId,
      provider,
      workspacePath,
      signal: enabled ? 'plan_enter' : 'plan_exit'
    }));
  });

  server.registerTool('voice_speak', {
    title: 'Speak Text',
    description: 'Synthesize and play text immediately through cli2voice.',
    inputSchema: {
      text: z.string(),
      sessionId: z.string().optional(),
      force: z.boolean().optional()
    }
  }, async ({ text, sessionId, force }) => textResult(await client.speak({ text, sessionId, force, source: 'mcp.voice_speak' })));

  server.registerTool('voice_stop_playback', {
    title: 'Stop Playback',
    description: 'Stop current playback.',
    inputSchema: {}
  }, async () => textResult(await client.stopPlayback()));

  server.registerResource(
    'voice-status',
    'voice://status',
    {
      title: 'Voice Status',
      description: 'Current cli2voice daemon status.'
    },
    async () => ({
      contents: [
        {
          uri: 'voice://status',
          text: JSON.stringify(await client.status(), null, 2),
          mimeType: 'application/json'
        }
      ]
    })
  );

  server.registerResource(
    'voice-sessions',
    'voice://sessions',
    {
      title: 'Voice Sessions',
      description: 'Tracked cli2voice sessions.'
    },
    async () => ({
      contents: [
        {
          uri: 'voice://sessions',
          text: JSON.stringify(await client.listSessions(), null, 2),
          mimeType: 'application/json'
        }
      ]
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
