import { describe, expect, it } from 'vitest';
import {
  type FontPreference,
  deriveFontSizeTokens,
  resolveFontSizeTokens,
  resolveFlowChatFontSizeTokens,
  PRESET_UI_BASE_PX,
} from './index';

const SYNC_PREFERENCE: FontPreference = {
  uiSize: { level: 'default', customPx: null },
  flowChat: { mode: 'sync', basePx: null },
  markdownEditor: { mode: 'sync', basePx: null },
};

describe('deriveFontSizeTokens', () => {
  it('returns correct token ladder for default base (14px)', () => {
    const tokens = deriveFontSizeTokens(14);
    expect(tokens.base).toBe('14px');
    expect(tokens.sm).toBe('13px');
    expect(tokens.xs).toBe('12px');
    expect(tokens.lg).toBe('15px');
    expect(tokens.xl).toBe('16px');
    expect(tokens['2xl']).toBe('18px');
  });

  it('clamps below minimum (12px)', () => {
    const tokens = deriveFontSizeTokens(8);
    expect(tokens.base).toBe('12px');
  });

  it('clamps above maximum (20px)', () => {
    const tokens = deriveFontSizeTokens(24);
    expect(tokens.base).toBe('20px');
  });
});

describe('resolveFontSizeTokens', () => {
  it('returns preset tokens for named levels', () => {
    const tokens = resolveFontSizeTokens({ level: 'default', customPx: null });
    expect(tokens.base).toBe(`${PRESET_UI_BASE_PX.default}px`);
  });

  it('derives tokens for custom level', () => {
    const tokens = resolveFontSizeTokens({ level: 'custom', customPx: 16 });
    expect(tokens.base).toBe('16px');
  });

  it('rejects a custom level without an accepted customPx', () => {
    expect(() => resolveFontSizeTokens({ level: 'custom', customPx: null }))
      .toThrow('Custom UI font size is missing');
  });
});

describe('resolveFlowChatFontSizeTokens', () => {
  it('sync mode matches UI tokens exactly', () => {
    const tokens = resolveFlowChatFontSizeTokens(SYNC_PREFERENCE);
    expect(tokens.base).toBe(`${PRESET_UI_BASE_PX.default}px`);
  });

  it('independent mode uses custom basePx', () => {
    const pref: FontPreference = {
      ...SYNC_PREFERENCE,
      flowChat: { mode: 'independent', basePx: 18 },
    };
    const tokens = resolveFlowChatFontSizeTokens(pref);
    expect(tokens.base).toBe('18px');
  });

  it('rejects independent mode without an accepted basePx', () => {
    const pref: FontPreference = {
      ...SYNC_PREFERENCE,
      flowChat: { mode: 'independent', basePx: null },
    };
    expect(() => resolveFlowChatFontSizeTokens(pref))
      .toThrow('Independent flow-chat font size is missing');
  });
});
