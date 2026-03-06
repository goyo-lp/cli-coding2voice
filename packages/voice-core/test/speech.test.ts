import { describe, expect, it } from 'vitest';
import { toSpeechDecision } from '../src/speech.js';

describe('toSpeechDecision', () => {
  it('rejects empty text', () => {
    expect(toSpeechDecision('   ')).toEqual({ shouldSpeak: false, reason: 'empty', textForSpeech: '' });
  });

  it('cleans markdown for natural language speech', () => {
    const decision = toSpeechDecision('## Result\n- Use `npm test` next.');
    expect(decision.shouldSpeak).toBe(true);
    expect(decision.reason).toBe('natural-language');
    expect(decision.textForSpeech).toBe('Result Use npm test next.');
  });

  it('summarizes code-heavy text', () => {
    const decision = toSpeechDecision('```ts\nconst value = 1;\n```\n+ diff\nREADME.md\nsrc/index.ts');
    expect(decision.shouldSpeak).toBe(true);
    expect(decision.reason).toBe('code-heavy-summary');
  });
});
