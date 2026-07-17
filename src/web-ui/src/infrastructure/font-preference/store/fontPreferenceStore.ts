
import { create } from 'zustand';
import { createLogger } from '@/shared/utils/logger';
import {
  FontPreference,
  FontSizeLevel,
  FlowChatFontMode,
  MarkdownEditorFontMode,
} from '../types';
import { fontPreferenceService } from '../core/FontPreferenceService';

const log = createLogger('FontPreferenceStore');

interface FontPreferenceState {
  preference: FontPreference | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  setUiSize: (level: FontSizeLevel, customPx?: number) => Promise<void>;
  setFlowChatFont: (mode: FlowChatFontMode, basePx?: number) => Promise<void>;
  setMarkdownEditorFont: (mode: MarkdownEditorFontMode, basePx?: number) => Promise<void>;
  reset: () => Promise<void>;
}

let subscriptionsRegistered = false;

export const useFontPreferenceStore = create<FontPreferenceState>((set, get) => ({
  preference: null,
  initialized: false,
  loading: false,
  error: null,

  initialize: async () => {
    if (get().loading || (get().initialized && !get().error)) return;
    set({ loading: true, error: null });
    try {
      if (!subscriptionsRegistered) {
        subscriptionsRegistered = true;
        fontPreferenceService.on('font:after-change', (event) => {
          set({
            preference: event.preference,
            initialized: true,
            error: null,
          });
        });
        fontPreferenceService.onStatusChange((error) => {
          if (error) {
            set({
              preference: null,
              initialized: false,
              loading: false,
              error: error.message,
            });
            return;
          }
          const preference = fontPreferenceService.getPreference();
          set({
            preference,
            initialized: preference !== null,
            error: null,
          });
        });
      }

      await fontPreferenceService.initialize();

      const preference = fontPreferenceService.getPreference();
      if (!preference) {
        throw new Error('Font preference did not produce an authoritative projection');
      }
      set({
        preference,
        initialized: true,
        loading: false,
      });
    } catch (error) {
      log.error('Failed to initialize font preference', error);
      set({
        preference: null,
        initialized: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to initialize font preference',
      });
    }
  },

  setUiSize: async (level: FontSizeLevel, customPx?: number) => {
    set({ error: null });
    try {
      await fontPreferenceService.setUiSize(level, customPx);
    } catch (error) {
      log.error('Failed to set UI font size', { level, customPx, error });
      set({ error: error instanceof Error ? error.message : 'Failed to set UI font size' });
    }
  },

  setFlowChatFont: async (mode: FlowChatFontMode, basePx?: number) => {
    set({ error: null });
    try {
      await fontPreferenceService.setFlowChatFont(mode, basePx);
    } catch (error) {
      log.error('Failed to set flow chat font', { mode, basePx, error });
      set({ error: error instanceof Error ? error.message : 'Failed to set flow chat font' });
    }
  },

  setMarkdownEditorFont: async (mode: MarkdownEditorFontMode, basePx?: number) => {
    set({ error: null });
    try {
      await fontPreferenceService.setMarkdownEditorFont(mode, basePx);
    } catch (error) {
      log.error('Failed to set Markdown editor font', { mode, basePx, error });
      set({ error: error instanceof Error ? error.message : 'Failed to set Markdown editor font' });
    }
  },

  reset: async () => {
    set({ error: null });
    try {
      await fontPreferenceService.reset();
    } catch (error) {
      log.error('Failed to reset font preference', error);
      set({ error: error instanceof Error ? error.message : 'Failed to reset font preference' });
    }
  },
}));
