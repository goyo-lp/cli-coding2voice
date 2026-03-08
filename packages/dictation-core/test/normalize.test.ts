import { describe, expect, it } from 'vitest';
import { normalizeTranscriptForInsertion, shouldSuppressTerminalInput } from '../src/normalize.js';

describe('normalizeTranscriptForInsertion', () => {
  it('collapses whitespace and trims the transcript', () => {
    expect(normalizeTranscriptForInsertion('  hello\n   world  ')).toBe('hello world');
  });
});

describe('shouldSuppressTerminalInput', () => {
  it('suppresses ctrl-v when dictation is enabled for the control_v shortcut', () => {
    expect(shouldSuppressTerminalInput(Buffer.from([0x16]), true, 'control_v')).toBe(true);
  });

  it('does not suppress other inputs', () => {
    expect(shouldSuppressTerminalInput(Buffer.from('a'), true, 'control_v')).toBe(false);
    expect(shouldSuppressTerminalInput(Buffer.from([0x16]), true, 'right_option')).toBe(false);
  });
});
