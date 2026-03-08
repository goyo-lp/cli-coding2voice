import { describe, expect, it } from 'vitest';
import { TerminalTranscriptPreview } from '../src/inserter.js';

describe('TerminalTranscriptPreview', () => {
  it('replaces only the changed suffix for live partials', () => {
    const writes: Array<string | Buffer> = [];
    const preview = new TerminalTranscriptPreview((value) => {
      writes.push(value);
    });

    preview.preview('hello wor');
    preview.preview('hello world');
    preview.preview('hello there');

    expect(writes).toEqual([
      'hello wor',
      'ld',
      Buffer.alloc(5, 0x7f),
      'there'
    ]);
  });

  it('clears the transient preview without removing committed text', () => {
    const writes: Array<string | Buffer> = [];
    const preview = new TerminalTranscriptPreview((value) => {
      writes.push(value);
    });

    preview.preview('hello');
    preview.commit('hello world');
    preview.clear();

    expect(writes).toEqual(['hello', ' world']);
  });
});
