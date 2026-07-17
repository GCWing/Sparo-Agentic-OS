 

import { create } from 'zustand';
import { ThemeConfig, ThemeId, ThemeMetadata, ThemeSelectionId } from '../types';
import { themeService } from '../core/ThemeService';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ThemeStore');

 
interface ThemeState {
  
  currentTheme: ThemeConfig | null;
  currentThemeId: ThemeSelectionId | null;
  themes: ThemeMetadata[];
  loading: boolean;
  error: string | null;
  
  
  initialize: () => Promise<void>;
  setTheme: (themeId: ThemeSelectionId) => Promise<void>;
  refreshThemes: () => void;
  addTheme: (theme: ThemeConfig) => Promise<void>;
  removeTheme: (themeId: ThemeId) => Promise<void>;
  exportTheme: (themeId: ThemeId) => any;
}

let subscriptionsRegistered = false;

 
export const useThemeStore = create<ThemeState>((set, get) => ({
  
  currentTheme: null,
  currentThemeId: null,
  themes: [],
  loading: false,
  error: null,
  
  
  initialize: async () => {
    if (get().loading || (get().currentTheme && !get().error)) return;
    set({ loading: true, error: null });
    
    try {
      if (!subscriptionsRegistered) {
        subscriptionsRegistered = true;
        themeService.on('theme:after-change', () => {
          set({
            currentTheme: themeService.getCurrentTheme(),
            currentThemeId: themeService.getCurrentThemeId(),
            error: null,
          });
        });
        themeService.on('theme:register', () => {
          set({ themes: themeService.getThemeList() });
        });
        themeService.on('theme:unregister', () => {
          set({ themes: themeService.getThemeList() });
        });
        themeService.onStatusChange((error) => {
          if (error) {
            set({
              currentTheme: null,
              currentThemeId: null,
              loading: false,
              error: error.message,
            });
            return;
          }
          set({
            currentTheme: themeService.getCurrentTheme(),
            currentThemeId: themeService.getCurrentThemeId(),
            themes: themeService.getThemeList(),
            error: null,
          });
        });
      }

      await themeService.initialize();
      
      
      const themes = themeService.getThemeList();
      
      set({
        themes,
        loading: false,
        currentTheme: themeService.getCurrentTheme(),
        currentThemeId: themeService.getCurrentThemeId(),
      });
    } catch (error) {
      log.error('Failed to initialize', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to initialize theme system',
      });
    }
  },
  
  
  setTheme: async (themeId: ThemeSelectionId) => {
    set({ loading: true, error: null });
    
    try {
      await themeService.applyTheme(themeId);
      
      
      
      set({ loading: false });
    } catch (error) {
      log.error('Failed to switch theme', { themeId, error });
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to switch theme',
      });
    }
  },
  
  
  refreshThemes: () => {
    const themes = themeService.getThemeList();
    set({ themes });
  },
  
  
  addTheme: async (theme: ThemeConfig) => {
    set({ loading: true, error: null });
    
    try {
      await themeService.registerTheme(theme);
      const themes = themeService.getThemeList();
      
      set({
        themes,
        loading: false,
      });
    } catch (error) {
      log.error('Failed to add theme', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to add theme',
      });
    }
  },
  
  
  removeTheme: async (themeId: ThemeId) => {
    set({ loading: true, error: null });
    
    try {
      const success = await themeService.unregisterTheme(themeId);
      
      if (success) {
        const themes = themeService.getThemeList();
        set({
          themes,
          loading: false,
        });
      } else {
        set({
          loading: false,
          error: 'Failed to delete theme',
        });
      }
    } catch (error) {
      log.error('Failed to remove theme', { themeId, error });
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete theme',
      });
    }
  },
  
  
  exportTheme: (themeId: ThemeId) => {
    return themeService.exportTheme(themeId);
  },
}));


