import { describe, expect, it } from 'vitest';
import {
  detectComposerInput,
  removeComposerInputTriggerToken,
} from './composerInputDetection';

describe('detectComposerInput', () => {
  it('detects a leading slash command token without knowing command definitions', () => {
    const detection = detectComposerInput({ text: '/goal ship the feature' });

    expect(detection).toMatchObject({
      kind: 'slash-command',
      position: 'start',
      rawToken: '/goal',
      query: 'goal',
      hasWhitespaceAfterToken: true,
      hasArguments: true,
      argumentText: 'ship the feature',
    });
    expect(removeComposerInputTriggerToken('/goal ship the feature', detection)).toBe('ship the feature');
  });

  it('detects a slash token at the beginning of the current line', () => {
    const text = 'Context\n  /btw explain this';
    const detection = detectComposerInput({ text });

    expect(detection).toMatchObject({
      kind: 'slash-command',
      position: 'line-start',
      rawToken: '/btw',
      query: 'btw',
    });
    expect(removeComposerInputTriggerToken(text, detection)).toBe('Context\nexplain this');
  });

  it('ignores ordinary text and IME composition frames', () => {
    expect(detectComposerInput({ text: 'please /goal later' })).toEqual({ kind: 'none' });
    expect(detectComposerInput({ text: '/goal', isComposing: true })).toEqual({ kind: 'none' });
  });
});
