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

const COMMENTARY_MIN_LENGTH = 18;
const COMMENTARY_MAX_LENGTH = 260;
const COMMENTARY_TOOL_NOISE_PATTERNS = [
  /```/,
  /\bChunk ID:/,
  /\bProcess exited with code\b/,
  /\bWall time:/,
  /\bOriginal token count:/,
  /\bOutput:\s*$/m,
  /\bModified files:/,
  /\bFinal contents:/,
  /\bInstalled skills:/,
  /\bWhat I verified:/,
  /\bSources used\b/i,
  /\bhttps?:\/\//i,
  /(^|\n)\s*[-*]\s+/,
  /(^|\n)\s*\d+\.\s+/,
  /\n\s*\n\s*\S/
] as const;

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

export function normalizeCommentaryForSpeech(message: string): string {
  return message
    .trim()
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSpeakableCommentaryMessage(message: string): boolean {
  const trimmed = message.trim();
  if (COMMENTARY_TOOL_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  const normalized = normalizeCommentaryForSpeech(trimmed);
  if (normalized.length < COMMENTARY_MIN_LENGTH || normalized.length > COMMENTARY_MAX_LENGTH) {
    return false;
  }

  const punctuationCount = (normalized.match(/[.?!]/g) ?? []).length;
  if (punctuationCount > 4) {
    return false;
  }

  const slashCount = (normalized.match(/\//g) ?? []).length;
  if (slashCount >= 3) {
    return false;
  }

  return true;
}

export function extractSpeakableCommentary(payload: CodexSessionEvent['payload']): string {
  if (!payload) return '';
  if (payload.type !== 'agent_message') return '';
  if (payload.phase !== 'commentary') return '';

  const raw = payload.message ?? '';
  if (!isSpeakableCommentaryMessage(raw)) {
    return '';
  }

  return normalizeCommentaryForSpeech(raw);
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

    if (event.type === 'event_msg' && event.payload?.type === 'agent_message' && event.payload?.phase === 'commentary') {
      const message = extractSpeakableCommentary(event.payload);
      if (message) {
        pushCandidate(message, index + 1, 'event_msg.agent_message.commentary');
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
