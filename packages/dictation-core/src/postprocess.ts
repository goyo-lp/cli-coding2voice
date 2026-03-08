import { normalizeTranscriptForInsertion } from './normalize.js';
import type { DictationCommandBinding, DictationConfig } from './types.js';

export type DictationFinalAction =
  | {
      kind: 'insert';
      text: string;
    }
  | {
      kind: 'command';
      binding: DictationCommandBinding;
      phrase: string;
    }
  | {
      kind: 'noop';
    };

export function preparePartialTranscript(text: string, config: DictationConfig): string {
  const normalized = applyDictionary(normalizeTranscriptForInsertion(text), config.dictionary);
  if (!normalized) {
    return '';
  }

  if (shouldSuppressPreviewForCommand(normalized, config)) {
    return '';
  }

  return normalized;
}

export function finalizeTranscript(text: string, config: DictationConfig): DictationFinalAction {
  const normalized = applyDictionary(normalizeTranscriptForInsertion(text), config.dictionary);
  if (!normalized) {
    return { kind: 'noop' };
  }

  const command = resolveCommand(normalized, config);
  if (command) {
    return {
      kind: 'command',
      binding: command.binding,
      phrase: command.phrase
    };
  }

  const snippet = resolveSnippet(normalized, config.snippets);
  if (snippet) {
    return {
      kind: 'insert',
      text: snippet
    };
  }

  return {
    kind: 'insert',
    text: normalized
  };
}

function shouldSuppressPreviewForCommand(text: string, config: DictationConfig): boolean {
  if (!config.commandMode.enabled) {
    return false;
  }

  const wakePhrase = normalizeLookupKey(config.commandMode.wakePhrase);
  if (!wakePhrase) {
    return false;
  }

  const normalized = normalizeLookupKey(text);
  return normalized === wakePhrase || normalized.startsWith(`${wakePhrase} `);
}

function resolveCommand(
  text: string,
  config: DictationConfig
): { binding: DictationCommandBinding; phrase: string } | null {
  if (!config.commandMode.enabled) {
    return null;
  }

  const wakePhrase = normalizeLookupKey(config.commandMode.wakePhrase);
  if (!wakePhrase) {
    return null;
  }

  const normalized = normalizeLookupKey(text);
  if (normalized !== wakePhrase && !normalized.startsWith(`${wakePhrase} `)) {
    return null;
  }

  const phrase = normalizeLookupKey(normalized.slice(wakePhrase.length));
  if (!phrase) {
    return null;
  }

  const commandEntry = Object.entries(config.commandMode.commands).find(
    ([key]) => normalizeLookupKey(key) === phrase
  );
  if (!commandEntry) {
    return null;
  }

  return {
    phrase,
    binding: commandEntry[1]
  };
}

function resolveSnippet(text: string, snippets: DictationConfig['snippets']): string | null {
  const normalized = normalizeLookupKey(text);
  if (!normalized) {
    return null;
  }

  const snippetEntry = Object.entries(snippets).find(([key]) => normalizeLookupKey(key) === normalized);
  if (!snippetEntry) {
    return null;
  }

  return snippetEntry[1];
}

function applyDictionary(text: string, dictionary: DictationConfig['dictionary']): string {
  let next = text;
  const replacements = Object.entries(dictionary)
    .map(([rawNeedle, replacement]) => [normalizeTranscriptForInsertion(rawNeedle), replacement] as const)
    .filter(([needle]) => needle.length > 0)
    .sort((left, right) => right[0].length - left[0].length);

  for (const [needle, replacement] of replacements) {
    next = replacePhrase(next, needle, replacement);
  }

  return normalizeTranscriptForInsertion(next);
}

function replacePhrase(text: string, needle: string, replacement: string): string {
  const prefixBoundary = startsWithWordCharacter(needle) ? '\\b' : '';
  const suffixBoundary = endsWithWordCharacter(needle) ? '\\b' : '';
  const regex = new RegExp(`${prefixBoundary}${escapeRegExp(needle)}${suffixBoundary}`, 'gi');
  return text.replace(regex, replacement);
}

function startsWithWordCharacter(value: string): boolean {
  return /^[A-Za-z0-9]/.test(value);
}

function endsWithWordCharacter(value: string): boolean {
  return /[A-Za-z0-9]$/.test(value);
}

function normalizeLookupKey(value: string): string {
  return normalizeTranscriptForInsertion(value).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
