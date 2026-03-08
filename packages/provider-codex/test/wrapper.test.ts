import { describe, expect, it } from 'vitest';
import {
  extractResumedCodexThreadId,
  isPrimaryCliSessionMeta,
  shouldReplayFromStart,
  WRAPPED_CODEX_DEFAULT_VOICE_MODE
} from '../src/wrapper.js';

describe('extractResumedCodexThreadId', () => {
  it('extracts the resumed thread id from codex resume commands', () => {
    expect(extractResumedCodexThreadId(['resume', '019ccf53-135e-7f73-b118-dcda23f2c3f7'])).toBe(
      '019ccf53-135e-7f73-b118-dcda23f2c3f7'
    );
  });

  it('returns null when the codex command is not resuming a thread', () => {
    expect(extractResumedCodexThreadId(['--model', 'gpt-5.4'])).toBeNull();
  });
});

describe('isPrimaryCliSessionMeta', () => {
  it('accepts session metadata for a primary cli session in the current cwd', () => {
    expect(
      isPrimaryCliSessionMeta(
        {
          id: 'thread-1',
          cwd: '/Users/goyolozano',
          source: 'cli',
          originator: 'codex_cli_rs'
        },
        '/Users/goyolozano'
      )
    ).toBe(true);
  });

  it('rejects subagent or cwd-mismatched session metadata', () => {
    expect(
      isPrimaryCliSessionMeta(
        {
          id: 'thread-1',
          cwd: '/Users/goyolozano/Desktop/AI Projects/cli-coding2voice',
          source: { subagent: {} },
          originator: 'codex_cli_rs'
        },
        '/Users/goyolozano/Desktop/AI Projects/cli-coding2voice'
      )
    ).toBe(false);
    expect(
      isPrimaryCliSessionMeta(
        {
          id: 'thread-1',
          cwd: '/Users/goyolozano',
          source: 'cli',
          originator: 'codex_cli_rs'
        },
        '/Users/goyolozano/Desktop/AI Projects/cli-coding2voice'
      )
    ).toBe(false);
  });
});

describe('shouldReplayFromStart', () => {
  it('replays fresh session files and skips older ones', () => {
    expect(shouldReplayFromStart({ birthtimeMs: 1_000 }, 2_000)).toBe(true);
    expect(shouldReplayFromStart({ birthtimeMs: 1_000 }, 7_000)).toBe(false);
  });
});

describe('WRAPPED_CODEX_DEFAULT_VOICE_MODE', () => {
  it('keeps voice enabled for wrapped codex sessions outside plan mode', () => {
    expect(WRAPPED_CODEX_DEFAULT_VOICE_MODE).toBe('always');
  });
});
