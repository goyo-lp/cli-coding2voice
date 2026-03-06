import { describe, expect, it } from 'vitest';
import { createSessionVoiceState, evaluateSessionActions, isSessionVoiceEnabled } from '../src/policy.js';

describe('voice policy', () => {
  it('uses plan mode by default', () => {
    const state = createSessionVoiceState('plan');
    expect(isSessionVoiceEnabled(state)).toBe(false);
    expect(isSessionVoiceEnabled({ ...state, planMode: true })).toBe(true);
  });

  it('respects global off mode', () => {
    const state = createSessionVoiceState('off');
    expect(isSessionVoiceEnabled(state)).toBe(false);
    expect(isSessionVoiceEnabled({ ...state, manualVoiceOverride: 'on' })).toBe(true);
  });

  it('evaluates controls before candidates', () => {
    const result = evaluateSessionActions([
      { kind: 'control', signal: 'plan_enter', source: 'test' },
      { kind: 'candidate', message: 'hello', source: 'test' },
      { kind: 'control', signal: 'manual_voice_off', source: 'test' },
      { kind: 'candidate', message: 'second', source: 'test' }
    ]);

    expect(result.candidates).toEqual([
      { message: 'hello', shouldSpeak: true, line: undefined, source: 'test' },
      { message: 'second', shouldSpeak: false, line: undefined, source: 'test' }
    ]);
  });
});
