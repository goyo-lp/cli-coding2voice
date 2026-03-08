import { describe, expect, it } from 'vitest';
import { parseMacosDictationEvent } from '../src/helper.js';

describe('parseMacosDictationEvent', () => {
  it('parses recording stopped events', () => {
    expect(
      parseMacosDictationEvent(
        JSON.stringify({
          type: 'recording_stopped',
          audioPath: '/tmp/test.wav',
          reason: 'released',
          shortcut: 'right_option',
          backend: 'daemon_whisper'
        })
      )
    ).toEqual({
      type: 'recording_stopped',
      audioPath: '/tmp/test.wav',
      reason: 'released',
      shortcut: 'right_option',
      backend: 'daemon_whisper'
    });
  });

  it('parses native partial transcript events', () => {
    expect(
      parseMacosDictationEvent(
        JSON.stringify({
          type: 'transcript_partial',
          text: 'hello world',
          shortcut: 'right_option',
          backend: 'macos_native'
        })
      )
    ).toEqual({
      type: 'transcript_partial',
      text: 'hello world',
      shortcut: 'right_option',
      backend: 'macos_native'
    });
  });

  it('parses native empty transcript events', () => {
    expect(
      parseMacosDictationEvent(
        JSON.stringify({
          type: 'transcript_empty',
          reason: 'timeout',
          shortcut: 'right_option',
          backend: 'macos_native'
        })
      )
    ).toEqual({
      type: 'transcript_empty',
      reason: 'timeout',
      shortcut: 'right_option',
      backend: 'macos_native'
    });
  });

  it('returns null for invalid payloads', () => {
    expect(parseMacosDictationEvent('not-json')).toBeNull();
  });
});
