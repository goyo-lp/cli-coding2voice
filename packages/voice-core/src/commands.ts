import type { SessionControlSignal } from './types.js';

export type ParsedControlCommand =
  | { kind: 'signal'; signal: SessionControlSignal }
  | { kind: 'status' };

function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseExplicitControlCommand(text: string): ParsedControlCommand | null {
  const normalized = normalizeCommand(text);
  if (!normalized.startsWith('/')) return null;

  if (normalized === '/plan') return { kind: 'signal', signal: 'plan_enter' };
  if (normalized === '/default') return { kind: 'signal', signal: 'plan_exit' };
  if (normalized === '/voice status') return { kind: 'status' };
  if (normalized === '/voice on') return { kind: 'signal', signal: 'manual_voice_on' };
  if (normalized === '/voice off') return { kind: 'signal', signal: 'manual_voice_off' };
  if (normalized === '/voice default') return { kind: 'signal', signal: 'manual_voice_default' };

  return null;
}
