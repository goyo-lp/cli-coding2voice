type DictationWrite = string | Buffer;

export class TerminalTranscriptPreview {
  private previewText = '';

  constructor(private readonly write: (value: DictationWrite) => void) {}

  preview(text: string): void {
    this.applyDiff(this.previewText, text);
    this.previewText = text;
  }

  commit(text: string): void {
    this.applyDiff(this.previewText, text);
    this.previewText = '';
  }

  clear(): void {
    this.applyDiff(this.previewText, '');
    this.previewText = '';
  }

  current(): string {
    return this.previewText;
  }

  private applyDiff(previous: string, next: string): void {
    const previousChars = Array.from(previous);
    const nextChars = Array.from(next);
    let prefixLength = 0;

    while (
      prefixLength < previousChars.length &&
      prefixLength < nextChars.length &&
      previousChars[prefixLength] === nextChars[prefixLength]
    ) {
      prefixLength += 1;
    }

    const removed = previousChars.length - prefixLength;
    if (removed > 0) {
      this.write(Buffer.alloc(removed, 0x7f));
    }

    const added = nextChars.slice(prefixLength).join('');
    if (added) {
      this.write(added);
    }
  }
}
