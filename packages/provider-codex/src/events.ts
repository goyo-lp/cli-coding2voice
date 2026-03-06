import { parseExplicitControlCommand, type SessionAction, type SessionControlSignal } from '@cli2voice/voice-core';

export type ResponseContentItem = {
  type?: string;
  text?: string;
};

export type CodexSessionEvent = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    phase?: string;
    role?: string;
    message?: string;
    last_agent_message?: string;
    collaboration_mode_kind?: string;
    collaboration_mode?: {
      mode?: string;
    };
    content?: ResponseContentItem[];
  };
};

export type ParseCodexActionsOptions = {
  debug?: boolean;
  adjacentDuplicateLineWindow?: number;
};

export type ParseCodexActionsResult = {
  actions: SessionAction[];
  traces: string[];
};

function extractFinalAnswerFromResponseItem(payload: CodexSessionEvent['payload']): string {
  if (!payload) return '';
  if (payload.type !== 'message') return '';
  if (payload.role !== 'assistant') return '';
  if (payload.phase !== 'final_answer') return '';

  return (payload.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseModeSignal(value: string): SessionControlSignal | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'plan') return 'plan_enter';
  if (normalized === 'default') return 'plan_exit';
  return null;
}

export function parseCodexSessionActionsDetailed(
  jsonlChunk: string,
  options: ParseCodexActionsOptions = {}
): ParseCodexActionsResult {
  const actions: SessionAction[] = [];
  const traces: string[] = [];
  const debug = Boolean(options.debug);
  const duplicateWindow = options.adjacentDuplicateLineWindow ?? 5;
  let lastAccepted: { message: string; line: number } | null = null;

  const pushCandidate = (message: string, line: number, source: string): void => {
    if (lastAccepted && lastAccepted.message === message && line - lastAccepted.line <= duplicateWindow) {
      if (debug) traces.push(`line ${line}: dedupe ${source}`);
      return;
    }
    actions.push({ kind: 'candidate', message, line, source, dedupeKey: message });
    lastAccepted = { message, line };
    if (debug) traces.push(`line ${line}: accept ${source}`);
  };

  const lines = jsonlChunk.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed) continue;

    let event: CodexSessionEvent;
    try {
      event = JSON.parse(trimmed) as CodexSessionEvent;
    } catch {
      if (debug) traces.push(`line ${index + 1}: skip invalid json`);
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'task_started') {
      const signal = parseModeSignal(event.payload.collaboration_mode_kind ?? '');
      if (signal) {
        actions.push({ kind: 'control', signal, line: index + 1, source: 'event_msg.task_started.collaboration_mode_kind' });
      }
      continue;
    }

    if (event.type === 'turn_context') {
      const signal = parseModeSignal(event.payload?.collaboration_mode?.mode ?? '');
      if (signal) {
        actions.push({ kind: 'control', signal, line: index + 1, source: 'turn_context.collaboration_mode.mode' });
      }
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'user_message') {
      const parsed = parseExplicitControlCommand((event.payload.message ?? '').trim());
      if (parsed?.kind === 'signal') {
        actions.push({ kind: 'control', signal: parsed.signal, line: index + 1, source: 'event_msg.user_message.command' });
      }
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'agent_message' && event.payload?.phase === 'final_answer') {
      const message = (event.payload.message ?? event.payload.last_agent_message ?? '').trim();
      if (message) {
        pushCandidate(message, index + 1, 'event_msg.agent_message.final_answer');
      }
      continue;
    }

    if (event.type === 'event_msg' && event.payload?.type === 'task_complete') {
      const message = event.payload.last_agent_message?.trim();
      if (message) {
        pushCandidate(message, index + 1, 'event_msg.task_complete.last_agent_message');
      }
      continue;
    }

    if (event.type === 'response_item') {
      const message = extractFinalAnswerFromResponseItem(event.payload);
      if (message) {
        pushCandidate(message, index + 1, 'response_item.message.final_answer');
      }
    }
  }

  return { actions, traces };
}
