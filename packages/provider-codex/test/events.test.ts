import { describe, expect, it } from 'vitest';
import {
  extractSpeakableCommentary,
  normalizeCommentaryForSpeech,
  parseCodexSessionActionsDetailed
} from '../src/events.js';

describe('normalizeCommentaryForSpeech', () => {
  it('removes markdown wrappers that sound awkward when spoken', () => {
    expect(
      normalizeCommentaryForSpeech(
        'I found `codex2voice` and I am checking [the daemon](https://example.com/docs) now.'
      )
    ).toBe('I found codex2voice and I am checking the daemon now.');
  });
});

describe('extractSpeakableCommentary', () => {
  it('accepts short natural-language commentary updates', () => {
    expect(
      extractSpeakableCommentary({
        type: 'agent_message',
        phase: 'commentary',
        message: "I'm checking the daemon startup path now so speech can begin sooner."
      })
    ).toBe("I'm checking the daemon startup path now so speech can begin sooner.");
  });

  it('skips commentary that is mostly tool or code noise', () => {
    expect(
      extractSpeakableCommentary({
        type: 'agent_message',
        phase: 'commentary',
        message: 'Modified files:\n- `packages/voice-daemon/src/runtime.ts`\n- `packages/provider-codex/src/events.ts`'
      })
    ).toBe('');
  });
});

describe('parseCodexSessionActionsDetailed', () => {
  it('emits conservative commentary candidates before the final answer', () => {
    const result = parseCodexSessionActionsDetailed(
      [
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            phase: 'commentary',
            message: "I'm checking the speech pipeline now so output can start sooner."
          }
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            phase: 'final_answer',
            message: 'The next step is to restart the daemon.'
          }
        })
      ].join('\n')
    );

    expect(result.actions).toEqual([
      {
        kind: 'candidate',
        message: "I'm checking the speech pipeline now so output can start sooner.",
        line: 1,
        source: 'event_msg.agent_message.commentary',
        dedupeKey: "I'm checking the speech pipeline now so output can start sooner."
      },
      {
        kind: 'candidate',
        message: 'The next step is to restart the daemon.',
        line: 2,
        source: 'event_msg.agent_message.final_answer',
        dedupeKey: 'The next step is to restart the daemon.'
      }
    ]);
  });

  it('ignores commentary that looks like logs or structured output', () => {
    const result = parseCodexSessionActionsDetailed(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: 'commentary',
          message: 'Chunk ID: 12345\nWall time: 0.1 seconds\nOutput:\nhello'
        }
      })
    );

    expect(result.actions).toEqual([]);
  });
});
