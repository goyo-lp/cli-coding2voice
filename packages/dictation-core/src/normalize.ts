export function normalizeTranscriptForInsertion(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function shouldSuppressTerminalInput(
  chunk: Buffer,
  dictationEnabled: boolean,
  shortcut: 'right_option' | 'control_v'
): boolean {
  if (!dictationEnabled) return false;
  if (shortcut !== 'control_v') return false;
  return chunk.length === 1 && chunk[0] === 0x16;
}
