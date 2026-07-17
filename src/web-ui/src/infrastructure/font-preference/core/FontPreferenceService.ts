
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { createLogger } from '@/shared/utils/logger';
import {
  FontPreference,
  FontPreferenceEvent,
  FontPreferenceEventListener,
  FontPreferenceEventType,
  FlowChatFontMode,
  FontSizeLevel,
  FontSizeTokens,
  MarkdownEditorFontMode,
  UiFontSizePreference,
  deriveFontSizeTokens,
  resolveFontSizeTokens,
  resolveFlowChatFontSizeTokens,
  resolveMarkdownEditorFontSizeTokens,
} from '../types';

const log = createLogger('FontPreferenceService');

export const FONT_SETTING_NAMESPACE = 'core.font';

interface FontSettingProjection {
  ui_size: {
    level: FontSizeLevel;
    custom_px: number | null;
  };
  flow_chat: {
    mode: FlowChatFontMode;
    base_px: number | null;
  };
  markdown_editor: {
    mode: MarkdownEditorFontMode;
    base_px: number | null;
  };
}

type FontPreferenceStatusListener = (error: Error | null) => void;

const FONT_SIZE_LEVELS = new Set<FontSizeLevel>([
  'compact',
  'small',
  'default',
  'medium',
  'large',
  'custom',
]);

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Font preference is missing ${path}`);
  }
  return value as Record<string, unknown>;
}

function requireNullableFontPx(value: unknown, path: string, required: boolean): number | null {
  if (value === null && !required) return null;
  if (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= 12
    && value <= 20
    && required
  ) {
    return value;
  }
  throw new Error(`${path} must ${required ? 'be an integer from 12 to 20' : 'be null'}`);
}

/** Validates the complete Catalog + accepted Snapshot projection without defaults. */
export function parseFontPreferenceProjection(value: unknown): FontPreference {
  const root = requireRecord(value, 'font');
  const uiSize = requireRecord(root.ui_size, 'font.ui_size');
  const flowChat = requireRecord(root.flow_chat, 'font.flow_chat');
  const markdownEditor = requireRecord(root.markdown_editor, 'font.markdown_editor');

  if (typeof uiSize.level !== 'string' || !FONT_SIZE_LEVELS.has(uiSize.level as FontSizeLevel)) {
    throw new Error('font.ui_size.level is invalid');
  }
  const uiLevel = uiSize.level as FontSizeLevel;
  if (flowChat.mode !== 'sync' && flowChat.mode !== 'independent') {
    throw new Error('font.flow_chat.mode is invalid');
  }
  if (markdownEditor.mode !== 'sync' && markdownEditor.mode !== 'independent') {
    throw new Error('font.markdown_editor.mode is invalid');
  }

  return {
    uiSize: {
      level: uiLevel,
      customPx: requireNullableFontPx(
        uiSize.custom_px,
        'font.ui_size.custom_px',
        uiLevel === 'custom',
      ),
    },
    flowChat: {
      mode: flowChat.mode,
      basePx: requireNullableFontPx(
        flowChat.base_px,
        'font.flow_chat.base_px',
        flowChat.mode === 'independent',
      ),
    },
    markdownEditor: {
      mode: markdownEditor.mode,
      basePx: requireNullableFontPx(
        markdownEditor.base_px,
        'font.markdown_editor.base_px',
        markdownEditor.mode === 'independent',
      ),
    },
  };
}

function toFontSettingProjection(preference: FontPreference): FontSettingProjection {
  return {
    ui_size: {
      level: preference.uiSize.level,
      custom_px: preference.uiSize.customPx,
    },
    flow_chat: {
      mode: preference.flowChat.mode,
      base_px: preference.flowChat.basePx,
    },
    markdown_editor: {
      mode: preference.markdownEditor.mode,
      base_px: preference.markdownEditor.basePx,
    },
  };
}

function clonePreference(preference: FontPreference): FontPreference {
  return {
    uiSize: { ...preference.uiSize },
    flowChat: { ...preference.flowChat },
    markdownEditor: { ...preference.markdownEditor },
  };
}

export class FontPreferenceService {
  private preference: FontPreference | null = null;
  private listeners: Map<FontPreferenceEventType, Set<FontPreferenceEventListener>> = new Map();
  private statusListeners = new Set<FontPreferenceStatusListener>();
  /** Only register theme hook once (initialize may run from main + settings). */
  private themeSyncRegistered = false;
  private configSyncRegistered = false;
  private configRefreshQueued = false;

  // ---- Lifecycle ----

  async initialize(): Promise<void> {
    try {
      const saved = await this.loadAuthoritativePreference();
      this.commitPreference(saved);

      if (!this.themeSyncRegistered) {
        this.themeSyncRegistered = true;
        const { themeService } = await import('@/infrastructure/theme');
        themeService.on('theme:after-change', () => {
          if (this.preference) this.applyPreference(this.preference);
        });
      }

      if (!this.configSyncRegistered) {
        this.configSyncRegistered = true;
        configManager.watch(FONT_SETTING_NAMESPACE, () => this.queueAuthoritativeRefresh());
      }

      this.publishStatus(null);
      log.info('Font preference initialized', {
        level: saved.uiSize.level,
        flowChat: saved.flowChat.mode,
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.failAuthoritativeState(normalizedError);
      throw normalizedError;
    }
  }

  private async loadAuthoritativePreference(): Promise<FontPreference> {
    return parseFontPreferenceProjection(
      await configManager.getSetting<unknown>(FONT_SETTING_NAMESPACE),
    );
  }

  // ---- Read ----

  getPreference(): FontPreference | null {
    return this.preference ? clonePreference(this.preference) : null;
  }

  // ---- Write ----

  async setPreference(partial: Partial<FontPreference>): Promise<void> {
    const current = this.requirePreference();
    const candidate = parseFontPreferenceProjection(toFontSettingProjection({
      uiSize: partial.uiSize ?? current.uiSize,
      flowChat: partial.flowChat ?? current.flowChat,
      markdownEditor: partial.markdownEditor ?? current.markdownEditor,
    }));

    await configManager.setSetting(FONT_SETTING_NAMESPACE, toFontSettingProjection(candidate));
    try {
      const authoritative = await this.loadAuthoritativePreference();
      this.commitPreference(authoritative);
      this.publishStatus(null);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.failAuthoritativeState(normalizedError);
      throw normalizedError;
    }
  }

  async setUiSize(level: FontSizeLevel, customPx?: number): Promise<void> {
    if (level === 'custom' && customPx === undefined) {
      throw new Error('A custom UI font size is required');
    }
    const uiSize: UiFontSizePreference = level === 'custom'
      ? { level, customPx: Math.max(12, Math.min(20, Math.round(customPx!))) }
      : { level, customPx: null };
    await this.setPreference({ uiSize });
  }

  async setFlowChatFont(mode: FlowChatFontMode, basePx?: number): Promise<void> {
    if (mode === 'independent') {
      if (basePx === undefined) {
        throw new Error('An independent flow-chat font size is required');
      }
      await this.setPreference({
        flowChat: { mode, basePx: Math.max(12, Math.min(20, Math.round(basePx))) },
      });
      return;
    }
    await this.setPreference({ flowChat: { mode, basePx: null } });
  }

  async setMarkdownEditorFont(mode: MarkdownEditorFontMode, basePx?: number): Promise<void> {
    if (mode === 'independent') {
      if (basePx === undefined) {
        throw new Error('An independent Markdown font size is required');
      }
      await this.setPreference({
        markdownEditor: { mode, basePx: Math.max(12, Math.min(20, Math.round(basePx))) },
      });
      return;
    }
    await this.setPreference({ markdownEditor: { mode, basePx: null } });
  }

  async reset(): Promise<void> {
    await configManager.resetSetting(FONT_SETTING_NAMESPACE);
    try {
      const authoritative = await this.loadAuthoritativePreference();
      this.commitPreference(authoritative);
      this.publishStatus(null);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.failAuthoritativeState(normalizedError);
      throw normalizedError;
    }
  }

  private queueAuthoritativeRefresh(): void {
    if (this.configRefreshQueued) {
      return;
    }
    this.configRefreshQueued = true;
    queueMicrotask(() => {
      this.configRefreshQueued = false;
      void this.refreshFromAuthoritativeConfig();
    });
  }

  private async refreshFromAuthoritativeConfig(): Promise<void> {
    try {
      const next = await this.loadAuthoritativePreference();
      this.commitPreference(next);
      this.publishStatus(null);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to apply external font preference', { error: normalizedError });
      this.failAuthoritativeState(normalizedError);
    }
  }

  private requirePreference(): FontPreference {
    if (!this.preference) {
      throw new Error('Font preference has not loaded from the authoritative configuration');
    }
    return this.preference;
  }

  private commitPreference(next: FontPreference): void {
    const previous = this.preference ? clonePreference(this.preference) : undefined;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) {
      return;
    }
    const committed = clonePreference(next);
    this.emit({
      type: 'font:before-change',
      preference: committed,
      previousPreference: previous,
      timestamp: Date.now(),
    });
    this.applyPreference(committed);
    this.preference = committed;
    this.emit({
      type: 'font:after-change',
      preference: clonePreference(committed),
      previousPreference: previous,
      timestamp: Date.now(),
    });
  }

  private failAuthoritativeState(error: Error): void {
    this.preference = null;
    this.publishStatus(error);
  }

  // ---- CSS Application ----

  applyPreference(pref: FontPreference): void {
    const root = document.documentElement;
    const tokens = resolveFontSizeTokens(pref.uiSize);

    // Apply all UI font-size tokens — overrides tokens.scss :root defaults
    (Object.entries(tokens) as [string, string][]).forEach(([key, value]) => {
      root.style.setProperty(`--font-size-${key}`, value);
    });

    this.applyExtraFontSizeTokens(root, tokens);

    const flowTokens = resolveFlowChatFontSizeTokens(pref);
    (Object.entries(flowTokens) as [string, string][]).forEach(([key, value]) => {
      root.style.setProperty(`--flowchat-font-size-${key}`, value);
    });
    this.applyFlowChatExtraFontSizeTokens(root, flowTokens);
    this.applyCompactSurfaceFontSizeTokens(root, flowTokens);

    const markdownEditorTokens = resolveMarkdownEditorFontSizeTokens(pref);
    (Object.entries(markdownEditorTokens) as [string, string][]).forEach(([key, value]) => {
      root.style.setProperty(`--markdown-editor-font-size-${key}`, value);
    });

    // Drive body font-size so elements using `inherit` cascade to the new base size.
    // This is the broadest single-point fix for SCSS components that compiled their
    // font-size to literal px at build time (e.g. font-size: 14px).
    document.body.style.fontSize = tokens.base;

    log.debug('Font preference applied', { level: pref.uiSize.level });
  }

  // ---- Events ----

  on(type: FontPreferenceEventType, listener: FontPreferenceEventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  off(type: FontPreferenceEventType, listener: FontPreferenceEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  onStatusChange(listener: FontPreferenceStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private publishStatus(error: Error | null): void {
    for (const listener of this.statusListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        log.error('Font preference status listener error', { error: listenerError });
      }
    }
  }

  /** Smaller steps used by some SCSS (xxs / 2xs); badge uses xs scale. */
  private applyExtraFontSizeTokens(root: HTMLElement, tokens: FontSizeTokens): void {
    const xsPx = parseInt(tokens.xs, 10);
    if (!Number.isNaN(xsPx)) {
      const twoXs = Math.max(8, xsPx - 1);
      const xxs = Math.max(7, xsPx - 2);
      root.style.setProperty('--font-size-2xs', `${twoXs}px`);
      root.style.setProperty('--font-size-xxs', `${xxs}px`);
    }
    root.style.setProperty('--badge-font-size', tokens.xs);
  }

  private applyFlowChatExtraFontSizeTokens(root: HTMLElement, tokens: FontSizeTokens): void {
    const xsPx = parseInt(tokens.xs, 10);
    if (!Number.isNaN(xsPx)) {
      const twoXs = Math.max(8, xsPx - 1);
      const xxs = Math.max(7, xsPx - 2);
      root.style.setProperty('--flowchat-font-size-2xs', `${twoXs}px`);
      root.style.setProperty('--flowchat-font-size-xxs', `${xxs}px`);
    }
  }

  /**
   * Compact app surfaces use the same token names as global UI (`--font-size-*`) inside
   * their local scope, but stay slightly below the flow-chat panel scale.
   */
  private applyCompactSurfaceFontSizeTokens(root: HTMLElement, flowTokens: FontSizeTokens): void {
    const flowBasePx = parseInt(flowTokens.base, 10);
    if (Number.isNaN(flowBasePx)) {
      throw new Error('Flow-chat font token projection is invalid');
    }
    const compactBasePx = Math.max(12, flowBasePx - 1);
    const compactTokens = deriveFontSizeTokens(compactBasePx);
    (Object.entries(compactTokens) as [string, string][]).forEach(([key, value]) => {
      root.style.setProperty(`--ds-compact-font-size-${key}`, value);
    });
    this.applyCompactSurfaceExtraFontSizeTokens(root, compactTokens);
  }

  private applyCompactSurfaceExtraFontSizeTokens(root: HTMLElement, tokens: FontSizeTokens): void {
    const xsPx = parseInt(tokens.xs, 10);
    if (!Number.isNaN(xsPx)) {
      const twoXs = Math.max(8, xsPx - 1);
      const xxs = Math.max(7, xsPx - 2);
      root.style.setProperty('--ds-compact-font-size-2xs', `${twoXs}px`);
      root.style.setProperty('--ds-compact-font-size-xxs', `${xxs}px`);
    }
  }

  private emit(event: FontPreferenceEvent): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    listeners.forEach(listener => {
      try {
        void listener(event);
      } catch (error) {
        log.error('Font preference event listener error', { type: event.type, error });
      }
    });
  }

}

export const fontPreferenceService = new FontPreferenceService();
