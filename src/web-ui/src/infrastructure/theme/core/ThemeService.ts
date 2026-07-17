 

import {
  ThemeConfig,
  ThemeId,
  ThemeMetadata,
  ThemeExport,
  ThemeValidationResult,
  ThemeEventType,
  ThemeEvent,
  ThemeEventListener,
  ThemeHooks,
  SYSTEM_THEME_ID,
  ThemeSelectionId,
} from '../types';
import {
  builtinThemes,
  getSystemPreferredDefaultThemeId,
} from '../presets';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { monacoThemeSync } from '../integrations/MonacoThemeSync';
import { createLogger } from '@/shared/utils/logger';
import {
  applyCssVars,
  createComponentCssVarMap,
  createLegacyCssVarMap,
  createThemeCssVarMap,
} from '@/design-system';

const log = createLogger('ThemeService');
const THEMES_SETTING_NAMESPACE = 'core.themes';

interface StoredThemesConfig {
  current: ThemeSelectionId;
  custom: ThemeConfig[] | null;
}

type ThemeStatusListener = (error: Error | null) => void;

function parseStoredThemesConfig(raw: unknown): StoredThemesConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Theme settings are missing from the Catalog projection');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.current !== 'string' || record.current.trim() === '') {
    throw new Error('Theme settings are missing themes.current');
  }
  if (record.custom !== null && !Array.isArray(record.custom)) {
    throw new Error('Theme settings contain an invalid themes.custom value');
  }
  if (Array.isArray(record.custom)) {
    record.custom.forEach((theme, index) => {
      if (theme === null || typeof theme !== 'object' || Array.isArray(theme)) {
        throw new Error(`Theme settings contain an invalid custom theme at index ${index}`);
      }
    });
  }
  return {
    current: record.current,
    custom: record.custom as ThemeConfig[] | null,
  };
}


 
export class ThemeService {
  private themes: Map<ThemeId, ThemeConfig> = new Map();
  /** User choice from settings (including follow-system). */
  private themeSelection: ThemeSelectionId | null = null;
  /** Currently applied built-in or custom theme (never `system`). */
  private resolvedThemeId: ThemeId | null = null;
  private systemThemeCleanup: (() => void) | null = null;
  private listeners: Map<ThemeEventType, Set<ThemeEventListener>> = new Map();
  private statusListeners = new Set<ThemeStatusListener>();
  private hooks: ThemeHooks = {};
  private configWatchCleanup: (() => void) | null = null;
  private configRefreshSeq = 0;
  private configRefreshTail: Promise<void> = Promise.resolve();
  private initializing = false;
  private refreshRequestedDuringInitialization = false;
  
  constructor() {
    this.initializeBuiltinThemes();
  }
  
  
  
   
  private initializeBuiltinThemes(): void {
    builtinThemes.forEach(theme => {
      this.themes.set(theme.id, theme);
    });
    log.info('Loaded builtin themes', { count: builtinThemes.length });
  }
  
   
  async initialize(): Promise<void> {
    this.initializing = true;
    this.ensureConfigWatch();
    try {
      const storedConfig = await this.loadStoredThemesConfig();
      await this.applyAuthoritativeConfig(storedConfig);
      this.publishStatus(null);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      log.error('Theme system initialization failed', { error: normalizedError });
      this.publishStatus(normalizedError);
      throw normalizedError;
    } finally {
      this.initializing = false;
      if (this.refreshRequestedDuringInitialization) {
        this.refreshRequestedDuringInitialization = false;
        await this.queueAuthoritativeRefresh();
      }
    }
  }
  
  private async loadStoredThemesConfig(): Promise<StoredThemesConfig> {
    return parseStoredThemesConfig(
      await configManager.getSetting<unknown>(THEMES_SETTING_NAMESPACE),
    );
  }

  private buildThemeMap(config: StoredThemesConfig): Map<ThemeId, ThemeConfig> {
    const themes = new Map<ThemeId, ThemeConfig>(
      builtinThemes.map((theme) => [theme.id, theme]),
    );
    for (const theme of config.custom ?? []) {
      const validation = this.validateTheme(theme);
      if (!validation.valid || theme.id === SYSTEM_THEME_ID || themes.has(theme.id)) {
        throw new Error(`Invalid or duplicate custom theme id: ${theme.id || '<missing>'}`);
      }
      themes.set(theme.id, theme);
    }
    if (config.current !== SYSTEM_THEME_ID && !themes.has(config.current)) {
      throw new Error(`Unknown current theme id: ${config.current}`);
    }
    return themes;
  }

  private async applyAuthoritativeConfig(config: StoredThemesConfig): Promise<void> {
    const nextThemes = this.buildThemeMap(config);
    const previousSelectedTheme = this.themeSelection === null
      || this.themeSelection === SYSTEM_THEME_ID
      ? null
      : this.themes.get(this.themeSelection);
    const previousSelectedThemeJson = previousSelectedTheme
      ? JSON.stringify(previousSelectedTheme)
      : null;
    const nextSelectedTheme = config.current === SYSTEM_THEME_ID
      ? null
      : nextThemes.get(config.current);
    const selectedThemeChanged = config.current !== SYSTEM_THEME_ID
      && JSON.stringify(nextSelectedTheme) !== previousSelectedThemeJson;

    this.themes = nextThemes;
    if (
      this.resolvedThemeId === null
      || config.current !== this.themeSelection
      || selectedThemeChanged
    ) {
      await this.applyTheme(config.current, { persist: false });
    }

    const userThemeCount = config.custom?.length ?? 0;
    if (userThemeCount > 0) {
      log.info('Loaded user themes', { count: userThemeCount });
    }
  }

  private ensureConfigWatch(): void {
    if (this.configWatchCleanup) {
      return;
    }
    this.configWatchCleanup = configManager.watch(THEMES_SETTING_NAMESPACE, () => {
      if (this.initializing) {
        this.refreshRequestedDuringInitialization = true;
        return;
      }
      void this.queueAuthoritativeRefresh();
    });
  }

  private queueAuthoritativeRefresh(): Promise<void> {
    const refreshSeq = ++this.configRefreshSeq;
    const refresh = async () => {
      if (refreshSeq !== this.configRefreshSeq) {
        return;
      }
      await this.refreshFromAuthoritativeConfig(refreshSeq);
    };
    const scheduled = this.configRefreshTail.then(refresh, refresh);
    this.configRefreshTail = scheduled.catch(() => undefined);
    return scheduled;
  }

  private async refreshFromAuthoritativeConfig(refreshSeq: number): Promise<void> {
    try {
      const storedConfig = await this.loadStoredThemesConfig();
      if (refreshSeq !== this.configRefreshSeq) {
        return;
      }
      await this.applyAuthoritativeConfig(storedConfig);
      this.publishStatus(null);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to refresh authoritative theme configuration', { error: normalizedError });
      this.publishStatus(normalizedError);
    }
  }

  private async synchronizeAfterWrite(): Promise<void> {
    try {
      const storedConfig = await this.loadStoredThemesConfig();
      await this.applyAuthoritativeConfig(storedConfig);
      this.publishStatus(null);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.publishStatus(normalizedError);
      throw normalizedError;
    }
  }

  private requireAuthoritativeState(): void {
    if (this.themeSelection === null || this.resolvedThemeId === null) {
      throw new Error('Theme service has not loaded an authoritative configuration');
    }
  }
  
  
  
   
  async registerTheme(theme: ThemeConfig): Promise<void> {
    this.requireAuthoritativeState();
    if (theme.id === SYSTEM_THEME_ID) {
      log.error('Reserved theme id', { id: theme.id });
      throw new Error(`Theme id "${SYSTEM_THEME_ID}" is reserved`);
    }
    if (this.themes.has(theme.id)) {
      throw new Error(`Theme ${theme.id} already exists`);
    }
    const validation = this.validateTheme(theme);
    if (!validation.valid) {
      throw new Error(`Theme ${theme.id} is invalid`);
    }

    await configManager.updateSetting<unknown, StoredThemesConfig>(
      THEMES_SETTING_NAMESPACE,
      (raw) => {
        const current = parseStoredThemesConfig(raw);
        const currentThemes = this.buildThemeMap(current);
        if (currentThemes.has(theme.id)) {
          throw new Error(`Theme ${theme.id} already exists`);
        }
        return {
          current: current.current,
          custom: [...(current.custom ?? []), theme],
        };
      },
    );
    await this.synchronizeAfterWrite();
    const acceptedTheme = this.themes.get(theme.id);
    if (!acceptedTheme) {
      throw new Error(`Accepted theme snapshot does not contain ${theme.id}`);
    }
    this.emitEvent('theme:register', acceptedTheme.id, acceptedTheme);
    log.info('Theme registered', { id: acceptedTheme.id, name: acceptedTheme.name });
  }
  
   
  async unregisterTheme(themeId: ThemeId): Promise<boolean> {
    this.requireAuthoritativeState();
    const theme = this.themes.get(themeId);
    if (!theme) {
      log.warn('Theme not found', { id: themeId });
      return false;
    }
    
    
    const isBuiltin = builtinThemes.some(t => t.id === themeId);
    if (isBuiltin) {
      log.error('Cannot delete builtin theme', { id: themeId });
      return false;
    }
    
    
    await configManager.updateSetting<unknown, StoredThemesConfig>(
      THEMES_SETTING_NAMESPACE,
      (raw) => {
        const current = parseStoredThemesConfig(raw);
        const currentThemes = this.buildThemeMap(current);
        const acceptedTheme = currentThemes.get(themeId);
        if (!acceptedTheme || builtinThemes.some((builtin) => builtin.id === themeId)) {
          throw new Error(`Custom theme ${themeId} does not exist in the accepted snapshot`);
        }
        const nextUserThemes = (current.custom ?? [])
          .filter((candidate) => candidate.id !== themeId);
        return {
          current: current.current === themeId ? SYSTEM_THEME_ID : current.current,
          custom: nextUserThemes.length > 0 ? nextUserThemes : null,
        };
      },
    );
    await this.synchronizeAfterWrite();
    if (this.themes.has(themeId)) {
      throw new Error(`Accepted theme snapshot still contains ${themeId}`);
    }
    this.emitEvent('theme:unregister', themeId, theme);
    log.info('Theme unregistered', { id: themeId, name: theme.name });
    return true;
  }
  
   
  getTheme(themeId: ThemeId): ThemeConfig | undefined {
    return this.themes.get(themeId);
  }
  
   
  getCurrentTheme(): ThemeConfig {
    const theme = this.resolvedThemeId ? this.themes.get(this.resolvedThemeId) : null;
    if (!theme) {
      throw new Error('Theme service has no authoritative current theme');
    }
    return theme;
  }
  
   
  /** User selection for UI (may be `system`). */
  getCurrentThemeId(): ThemeSelectionId | null {
    return this.themeSelection;
  }

  /** Actually applied theme id (never `system`). */
  getResolvedThemeId(): ThemeId | null {
    return this.resolvedThemeId;
  }
  
   
  getThemeList(): ThemeMetadata[] {
    return Array.from(this.themes.values()).map(theme => ({
      id: theme.id,
      name: theme.name,
      type: theme.type,
      description: theme.description,
      author: theme.author,
      version: theme.version,
      builtin: builtinThemes.some(t => t.id === theme.id),
    }));
  }
  
  
  
   
  private detachSystemThemeListener(): void {
    if (this.systemThemeCleanup) {
      this.systemThemeCleanup();
      this.systemThemeCleanup = null;
    }
  }

  private attachSystemThemeListener(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    if (this.systemThemeCleanup) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (this.themeSelection !== SYSTEM_THEME_ID) {
        return;
      }
      const next = getSystemPreferredDefaultThemeId();
      if (next === this.resolvedThemeId) {
        return;
      }
      void this.applyResolvedTheme(next);
    };
    mq.addEventListener('change', handler);
    this.systemThemeCleanup = () => mq.removeEventListener('change', handler);
  }

  private async applyResolvedTheme(resolvedId: ThemeId): Promise<void> {
    const theme = this.themes.get(resolvedId);
    if (!theme) {
      log.error('Theme not found', { id: resolvedId });
      throw new Error(`Theme ${resolvedId} not found`);
    }

    const oldTheme = this.resolvedThemeId
      ? this.themes.get(this.resolvedThemeId)
      : undefined;

    try {
      if (this.hooks.beforeChange) {
        await this.hooks.beforeChange(theme, oldTheme);
      }
      this.emitEvent('theme:before-change', resolvedId, theme, oldTheme);

      this.resolvedThemeId = resolvedId;

      this.injectCSSVariables(theme);

      try {
        monacoThemeSync.syncTheme(theme);
      } catch (error) {
        log.warn('Monaco Editor theme sync failed', error);
      }

      if (this.hooks.afterChange) {
        await this.hooks.afterChange(theme, oldTheme);
      }
      this.emitEvent('theme:after-change', resolvedId, theme, oldTheme);

      log.info('Theme applied', { id: resolvedId, name: theme.name, selection: this.themeSelection });
    } catch (error) {
      log.error('Failed to apply theme', error);
      throw error;
    }
  }

  async applyTheme(
    themeId: ThemeId | typeof SYSTEM_THEME_ID,
    options: { persist?: boolean } = {}
  ): Promise<void> {
    const persist = options.persist ?? true;
    if (themeId !== SYSTEM_THEME_ID && !this.themes.has(themeId)) {
      log.error('Theme not found', { id: themeId });
      throw new Error(`Theme ${themeId} not found`);
    }

    if (persist) {
      this.requireAuthoritativeState();
      await this.saveThemeSelection(themeId);
      await this.synchronizeAfterWrite();
      return;
    }

    this.detachSystemThemeListener();
    if (themeId === SYSTEM_THEME_ID) {
      this.themeSelection = SYSTEM_THEME_ID;
      this.attachSystemThemeListener();
      const resolved = getSystemPreferredDefaultThemeId();
      await this.applyResolvedTheme(resolved);
    } else {
      this.themeSelection = themeId;
      await this.applyResolvedTheme(themeId);
    }
  }
  
   
  private injectCSSVariables(theme: ThemeConfig): void {
    const root = document.documentElement;
    const cssVars = {
      ...createThemeCssVarMap(theme),
      ...createLegacyCssVarMap(theme),
      ...createComponentCssVarMap(theme),
    };

    applyCssVars(root, cssVars);

    root.setAttribute('data-theme', theme.id);
    root.setAttribute('data-theme-type', theme.type);

    const isAgentCompanionWindow =
      root.dataset.sparoWindow === 'agent-companion';
    const bgPrimary = theme.colors.background.primary;
    const chromeBackground = isAgentCompanionWindow ? 'transparent' : bgPrimary;
    root.style.backgroundColor = chromeBackground;
    if (document.body) {
      document.body.style.backgroundColor = chromeBackground;
    }

    // Mirror just enough info to localStorage so the next cold start can
    // paint the splash + window chrome in the user's theme *before* React
    // and the Tauri config round-trip resolve. See `index.html`'s inline
    // bootstrap script. Failures here are silent — this is a UX cache, not
    // a source of truth.
    try {
      window.localStorage.setItem(
        'sparo:theme-bootstrap',
        JSON.stringify({
          id: theme.id,
          type: theme.type,
          bg: bgPrimary,
        }),
      );
    } catch {
      /* private mode / disabled storage — ignore */
    }
  }
  
   
  private async saveThemeSelection(selection: ThemeSelectionId): Promise<void> {
    await configManager.setSetting('core.themes.current', selection);
  }
  
  
  
   
  exportTheme(themeId: ThemeId): ThemeExport | null {
    const theme = this.themes.get(themeId);
    if (!theme) {
      log.error('Theme not found', { id: themeId });
      return null;
    }
    
    const metadata: ThemeMetadata = {
      id: theme.id,
      name: theme.name,
      type: theme.type,
      description: theme.description,
      author: theme.author,
      version: theme.version,
      builtin: builtinThemes.some(t => t.id === theme.id),
    };
    
    return {
      schema: '2.0.0',
      theme,
      metadata,
      exportedAt: new Date().toISOString(),
    };
  }
  
  
  
   
  validateTheme(theme: ThemeConfig): ThemeValidationResult {
    const errors: ThemeValidationResult['errors'] = [];
    const warnings: ThemeValidationResult['warnings'] = [];
    
    
    if (!theme.id) {
      errors.push({ path: 'id', message: 'Missing theme id', code: 'MISSING_ID' });
    }
    if (!theme.name) {
      errors.push({ path: 'name', message: 'Missing theme name', code: 'MISSING_NAME' });
    }
    if (!theme.type || !['dark', 'light'].includes(theme.type)) {
      errors.push({ path: 'type', message: 'Invalid theme type', code: 'INVALID_TYPE' });
    }
    
    
    if (!theme.colors) {
      errors.push({ path: 'colors', message: 'Missing color configuration', code: 'MISSING_COLORS' });
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  onStatusChange(listener: ThemeStatusListener): () => void {
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
        log.error('Theme status listener execution failed', { error: listenerError });
      }
    }
  }
  
  
  
   
  on(eventType: ThemeEventType, listener: ThemeEventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    
    this.listeners.get(eventType)!.add(listener);
    
    
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }
  
   
  private emitEvent(
    type: ThemeEventType,
    themeId: ThemeId,
    theme?: ThemeConfig,
    previousTheme?: ThemeConfig
  ): void {
    const event: ThemeEvent = {
      type,
      themeId,
      theme,
      previousTheme,
      timestamp: Date.now(),
    };
    
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          log.error('Event listener execution failed', { type, error });
        }
      });
    }
  }
  
  
  
   
  registerHooks(hooks: ThemeHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }
}


export const themeService = new ThemeService();

