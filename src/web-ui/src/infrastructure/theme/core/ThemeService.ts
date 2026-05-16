 

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
  resolveThemeId,
  resolveThemeSelectionId,
} from '../presets';
import { configAPI } from '@/infrastructure/api';
import { monacoThemeSync } from '../integrations/MonacoThemeSync';
import { createLogger } from '@/shared/utils/logger';
import {
  applyCssVars,
  createComponentCssVarMap,
  createLegacyCssVarMap,
  createThemeCssVarMap,
} from '@/design-system';

const log = createLogger('ThemeService');


 
export class ThemeService {
  private themes: Map<ThemeId, ThemeConfig> = new Map();
  /** User choice from settings (including follow-system). */
  private themeSelection: ThemeSelectionId = SYSTEM_THEME_ID;
  /** Currently applied built-in or custom theme (never `system`). */
  private resolvedThemeId: ThemeId = getSystemPreferredDefaultThemeId();
  private systemThemeCleanup: (() => void) | null = null;
  private listeners: Map<ThemeEventType, Set<ThemeEventListener>> = new Map();
  private hooks: ThemeHooks = {};
  
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
    try {
      const saved = resolveThemeSelectionId(await this.loadThemeSelection());

      if (saved === SYSTEM_THEME_ID) {
        await this.applyTheme(SYSTEM_THEME_ID);
      } else if (saved && this.themes.has(saved)) {
        await this.applyTheme(saved);
      } else {
        const preInjectedThemeId = document.documentElement.getAttribute('data-theme');
        const normalizedPre = preInjectedThemeId
          ? resolveThemeId(preInjectedThemeId as ThemeId)
          : null;
        if (normalizedPre && this.themes.has(normalizedPre)) {
          await this.applyTheme(normalizedPre);
        } else {
          await this.applyTheme(SYSTEM_THEME_ID);
        }
      }

      this.loadUserThemes().catch(() => {
        
      });
    } catch (error) {
      log.error('Theme system initialization failed', error);
      
      await this.applyTheme(SYSTEM_THEME_ID);
    }
  }
  
   
  private async loadUserThemes(): Promise<void> {
    try {
      // Read the whole themes section so missing optional `custom` does not surface
      // as an expected backend error during startup.
      const themesConfig = await configAPI.getConfig('themes', {
        skipRetryOnNotFound: true,
      }) as { custom?: ThemeConfig[] } | undefined;
      const themes = themesConfig?.custom;
      
      if (Array.isArray(themes) && themes.length > 0) {
        themes.forEach(theme => {
          this.themes.set(theme.id, theme);
        });
        log.info('Loaded user themes', { count: themes.length });
      }
    } catch (_error) {
      
    }
  }
  
   
  private async loadThemeSelection(): Promise<ThemeSelectionId | null> {
    try {
      
      const raw = await configAPI.getConfig('themes.current', {
        skipRetryOnNotFound: true
      }) as string | undefined;
      
      if (raw === SYSTEM_THEME_ID) {
        return SYSTEM_THEME_ID;
      }
      return raw || null;
    } catch (_error) {
      return null;
    }
  }
  
  
  
   
  registerTheme(theme: ThemeConfig): void {
    if (theme.id === SYSTEM_THEME_ID) {
      log.error('Reserved theme id', { id: theme.id });
      throw new Error(`Theme id "${SYSTEM_THEME_ID}" is reserved`);
    }
    if (this.themes.has(theme.id)) {
      log.warn('Theme already exists, will override', { id: theme.id });
    }
    
    this.themes.set(theme.id, theme);
    this.emitEvent('theme:register', theme.id, theme);
    log.info('Theme registered', { id: theme.id, name: theme.name });
  }
  
   
  unregisterTheme(themeId: ThemeId): boolean {
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
    
    
    if (this.themeSelection === themeId) {
      void this.applyTheme(SYSTEM_THEME_ID);
    }
    
    this.themes.delete(themeId);
    this.emitEvent('theme:unregister', themeId, theme);
    log.info('Theme unregistered', { id: themeId, name: theme.name });
    
    
    this.saveUserThemes();
    
    return true;
  }
  
   
  getTheme(themeId: ThemeId): ThemeConfig | undefined {
    return this.themes.get(themeId);
  }
  
   
  getCurrentTheme(): ThemeConfig {
    return this.themes.get(this.resolvedThemeId) || builtinThemes[0];
  }
  
   
  /** User selection for UI (may be `system`). */
  getCurrentThemeId(): ThemeSelectionId {
    return this.themeSelection;
  }

  /** Actually applied theme id (never `system`). */
  getResolvedThemeId(): ThemeId {
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

    const oldTheme = this.getCurrentTheme();

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

  async applyTheme(themeId: ThemeId | typeof SYSTEM_THEME_ID): Promise<void> {
    if (themeId !== SYSTEM_THEME_ID) {
      themeId = resolveThemeId(themeId as ThemeId);
    }
    if (themeId !== SYSTEM_THEME_ID && !this.themes.has(themeId)) {
      log.error('Theme not found', { id: themeId });
      throw new Error(`Theme ${themeId} not found`);
    }

    this.detachSystemThemeListener();

    if (themeId === SYSTEM_THEME_ID) {
      this.themeSelection = SYSTEM_THEME_ID;
      await this.saveThemeSelection(SYSTEM_THEME_ID);
      this.attachSystemThemeListener();
      const resolved = getSystemPreferredDefaultThemeId();
      await this.applyResolvedTheme(resolved);
    } else {
      this.themeSelection = themeId;
      await this.saveThemeSelection(themeId);
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

    const bgPrimary = theme.colors.background.primary;
    root.style.backgroundColor = bgPrimary;
    if (document.body) {
      document.body.style.backgroundColor = bgPrimary;
    }
  }
  
   
  private async saveThemeSelection(selection: ThemeSelectionId): Promise<void> {
    try {
      await configAPI.setConfig('themes.current', selection);
    } catch (error) {
      log.warn('Failed to save current theme ID', error);
    }
  }
  
   
  private async saveUserThemes(): Promise<void> {
    try {
      const userThemes = Array.from(this.themes.values()).filter(
        theme => !builtinThemes.some(t => t.id === theme.id)
      );
      await configAPI.setConfig('themes.custom', userThemes);
    } catch (error) {
      log.warn('Failed to save user themes', error);
    }
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

