import { describe, expect, it } from 'vitest';
import { parseExplicitControlCommand } from '../src/commands.js';

describe('parseExplicitControlCommand', () => {
  it('accepts explicit voice commands', () => {
    expect(parseExplicitControlCommand('/voice on')).toEqual({ kind: 'signal', signal: 'manual_voice_on' });
    expect(parseExplicitControlCommand('/voice off')).toEqual({ kind: 'signal', signal: 'manual_voice_off' });
    expect(parseExplicitControlCommand('/voice default')).toEqual({ kind: 'signal', signal: 'manual_voice_default' });
    expect(parseExplicitControlCommand('/voice status')).toEqual({ kind: 'status' });
  });

  it('accepts explicit plan commands', () => {
    expect(parseExplicitControlCommand('/plan')).toEqual({ kind: 'signal', signal: 'plan_enter' });
    expect(parseExplicitControlCommand('/default')).toEqual({ kind: 'signal', signal: 'plan_exit' });
  });

  it('rejects natural language toggles', () => {
    expect(parseExplicitControlCommand('turn voice on')).toBeNull();
    expect(parseExplicitControlCommand('voice off')).toBeNull();
  });
});
