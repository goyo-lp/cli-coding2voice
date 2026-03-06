import type { SpeechDecision } from './types.js';

function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function summarizeCodeHeavyText(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const fileMentions = lines
    .filter((line) => /\b(src|app|lib|test|package|readme|\.ts|\.js|\.tsx|\.jsx|\.py|\.md)\b/i.test(line))
    .slice(0, 3);

  if (fileMentions.length > 0) {
    return `I made code-focused updates. Key areas touched include ${fileMentions.join(', ')}.`;
  }

  return 'I made code-focused updates. Review the terminal output for the exact code changes.';
}

export function toSpeechDecision(text: string, summarizeCodeHeavy = true): SpeechDecision {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shouldSpeak: false, reason: 'empty', textForSpeech: '' };
  }

  const lineCount = trimmed.split('\n').length;
  const codeFenceCount = countMatches(trimmed, /```/g);
  const diffLikeLineCount = countMatches(trimmed, /^\+|^\-|^@@|^diff\s|^index\s/mg);
  const toolLineCount = countMatches(trimmed, /^\$|^npm\s|^yarn\s|^pnpm\s|^git\s/mg);

  const heavySignal = codeFenceCount * 8 + diffLikeLineCount + toolLineCount;
  const heavyThreshold = Math.max(12, Math.floor(lineCount * 0.4));

  if (heavySignal >= heavyThreshold) {
    if (!summarizeCodeHeavy) {
      return { shouldSpeak: false, reason: 'code-heavy', textForSpeech: '' };
    }

    return {
      shouldSpeak: true,
      reason: 'code-heavy-summary',
      textForSpeech: summarizeCodeHeavyText(trimmed)
    };
  }

  const cleaned = trimmed
    .replace(/```[\s\S]*?```/g, ' code block omitted ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2) {
    return { shouldSpeak: false, reason: 'too-short', textForSpeech: '' };
  }

  return { shouldSpeak: true, reason: 'natural-language', textForSpeech: cleaned };
}
