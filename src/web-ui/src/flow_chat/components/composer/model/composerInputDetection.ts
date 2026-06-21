export type ComposerInputTriggerPosition = 'start' | 'line-start' | 'inline';

export interface ComposerInputFrame {
  text: string;
  selectionStart?: number;
  selectionEnd?: number;
  isComposing?: boolean;
}

export interface ComposerSlashInputTrigger {
  kind: 'slash-command';
  position: ComposerInputTriggerPosition;
  tokenStart: number;
  tokenEnd: number;
  argumentStart: number;
  rawToken: string;
  query: string;
  hasWhitespaceAfterToken: boolean;
  hasArguments: boolean;
  argumentText: string;
}

export interface ComposerNoInputTrigger {
  kind: 'none';
}

export type ComposerInputDetection = ComposerSlashInputTrigger | ComposerNoInputTrigger;

export const NO_COMPOSER_INPUT_DETECTION: ComposerNoInputTrigger = {
  kind: 'none',
};

function clampCursor(text: string, cursor: number | undefined): number {
  if (typeof cursor !== 'number' || Number.isNaN(cursor)) {
    return text.length;
  }
  return Math.max(0, Math.min(text.length, cursor));
}

function getTriggerPosition(text: string, tokenStart: number): ComposerInputTriggerPosition {
  if (text.slice(0, tokenStart).trim().length === 0) {
    return 'start';
  }

  const linePrefix = text.slice(text.lastIndexOf('\n', tokenStart - 1) + 1, tokenStart);
  if (linePrefix.trim().length === 0) {
    return 'line-start';
  }

  return 'inline';
}

export function detectComposerInput(frame: ComposerInputFrame): ComposerInputDetection {
  if (frame.isComposing) {
    return NO_COMPOSER_INPUT_DETECTION;
  }

  const text = frame.text;
  const cursor = clampCursor(text, frame.selectionStart ?? frame.selectionEnd);
  if (cursor < 0 || cursor > text.length) {
    return NO_COMPOSER_INPUT_DETECTION;
  }

  const messageStart = text.search(/\S/);
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineIndent = text.slice(lineStart).match(/^\s*/)?.[0].length ?? 0;
  const lineTokenStart = lineStart + lineIndent;
  const tokenStart =
    messageStart >= 0 && text[messageStart] === '/' && cursor >= messageStart
      ? messageStart
      : text[lineTokenStart] === '/' && cursor >= lineTokenStart
        ? lineTokenStart
        : -1;

  if (tokenStart < 0) {
    return NO_COMPOSER_INPUT_DETECTION;
  }
  if (cursor < tokenStart) {
    return NO_COMPOSER_INPUT_DETECTION;
  }

  const afterSlash = text.slice(tokenStart);
  const tokenMatch = afterSlash.match(/^\/[^\s]*/);
  if (!tokenMatch) {
    return NO_COMPOSER_INPUT_DETECTION;
  }

  const rawToken = tokenMatch[0];
  const tokenEnd = tokenStart + rawToken.length;
  const hasWhitespaceAfterToken = /\s/.test(text[tokenEnd] ?? '');
  const argumentStart = hasWhitespaceAfterToken
    ? tokenEnd + (text.slice(tokenEnd).match(/^\s+/)?.[0].length ?? 0)
    : tokenEnd;
  const argumentText = text.slice(argumentStart);

  return {
    kind: 'slash-command',
    position: getTriggerPosition(text, tokenStart),
    tokenStart,
    tokenEnd,
    argumentStart,
    rawToken,
    query: rawToken.slice(1).toLowerCase(),
    hasWhitespaceAfterToken,
    hasArguments: argumentText.trim().length > 0,
    argumentText,
  };
}

export function removeComposerInputTriggerToken(
  text: string,
  detection: ComposerInputDetection,
): string {
  if (detection.kind !== 'slash-command') {
    return text;
  }

  const removeStart = detection.position === 'line-start'
    ? text.lastIndexOf('\n', Math.max(0, detection.tokenStart - 1)) + 1
    : detection.tokenStart;
  const removeEnd = detection.hasWhitespaceAfterToken ? detection.argumentStart : detection.tokenEnd;
  return `${text.slice(0, removeStart)}${text.slice(removeEnd)}`.replace(/^\s+/, '');
}
