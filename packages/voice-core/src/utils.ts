export function normalizeSpeechKey(message: string): string {
  return message.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function splitCompleteJsonlChunk(text: string): { completeChunk: string; trailingPartial: string } {
  if (!text) {
    return { completeChunk: '', trailingPartial: '' };
  }

  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline < 0) {
    return { completeChunk: '', trailingPartial: text };
  }

  return {
    completeChunk: text.slice(0, lastNewline + 1),
    trailingPartial: text.slice(lastNewline + 1)
  };
}
