import { describe, expect, it } from 'vitest';
import { finalizeTranscript, preparePartialTranscript } from '../src/postprocess.js';
import type { DictationConfig } from '../src/types.js';

function createConfig(overrides: Partial<DictationConfig> = {}): DictationConfig {
  return {
    enabled: true,
    shortcut: 'right_option',
    backend: 'macos_native',
    insertMode: 'type',
    sttModel: 'openai/whisper-large-v3-turbo',
    language: 'en',
    device: 'cpu',
    dtype: 'fp32',
    prewarm: true,
    partialResults: true,
    maxRecordingMs: 60000,
    dictionary: {},
    snippets: {},
    commandMode: {
      enabled: true,
      wakePhrase: 'command',
      commands: {
        send: 'submit'
      }
    },
    ...overrides
  };
}

describe('preparePartialTranscript', () => {
  it('applies dictionary replacements to partials', () => {
    const config = createConfig({
      dictionary: {
        codex: 'Codex'
      }
    });

    expect(preparePartialTranscript('open codex please', config)).toBe('open Codex please');
  });

  it('suppresses command phrases from live preview', () => {
    const config = createConfig();

    expect(preparePartialTranscript('command send', config)).toBe('');
  });
});

describe('finalizeTranscript', () => {
  it('expands matching snippets on final transcripts', () => {
    const config = createConfig({
      snippets: {
        'insert bug template': 'Bug report:\n- Expected\n- Actual'
      }
    });

    expect(finalizeTranscript('insert bug template', config)).toEqual({
      kind: 'insert',
      text: 'Bug report:\n- Expected\n- Actual'
    });
  });

  it('resolves wake-phrase commands before insertion', () => {
    const config = createConfig({
      commandMode: {
        enabled: true,
        wakePhrase: 'command',
        commands: {
          send: 'submit',
          'slash model': 'text:/model '
        }
      }
    });

    expect(finalizeTranscript('command send', config)).toEqual({
      kind: 'command',
      binding: 'submit',
      phrase: 'send'
    });
    expect(finalizeTranscript('command slash model', config)).toEqual({
      kind: 'command',
      binding: 'text:/model ',
      phrase: 'slash model'
    });
  });
});
