/**
 * headerStore — thin bridge that publishes active-session context to the UnifiedTopBar.
 *
 * ModernFlowChatContainer writes here whenever the active session changes.
 * UnifiedTopBar reads from here to render the unified context title and back button.
 *
 * Keeping this separate avoids a circular dependency between the app shell
 * and the flow_chat module.
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import type { ProductAppTopBarContext } from '../navigation/workspaceTopBarContext';

export interface SessionHeaderContext {
  /** Stable product identity for the active session. */
  descriptor: SessionDescriptor;
  /** Workspace root path shown next to the mode label. */
  workspacePath?: string;
  /** Resolved display name (same as sidebar), not the raw path basename. */
  workspaceDisplayName?: string;
  /** Product App identity and scope semantics, when this is an Intelligent App session. */
  productApp?: ProductAppTopBarContext;
}

export interface ContextNavAction {
  id: string;
  label: string;
  tooltip?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextNavOverride {
  title?: string;
  actions?: ContextNavAction[];
}

interface HeaderState {
  /** Active session context; null when no session is loaded. */
  sessionContext: SessionHeaderContext | null;

  /** Per-surface context-nav overrides registered by scenes. */
  contextNavOverrides: Record<string, ContextNavOverride>;

  /** Called by ModernFlowChatContainer when a session becomes active. */
  setSessionContext: (ctx: SessionHeaderContext) => void;

  /** Called when no session is active (e.g. app starts or session is closed). */
  clearSessionContext: () => void;

  /** Called by scenes that need to customize the shared context nav capsule. */
  setContextNavOverride: (surfaceId: string, override: ContextNavOverride) => void;

  /** Called by scenes when their custom context nav should no longer apply. */
  clearContextNavOverride: (surfaceId: string) => void;
}

export const useHeaderStore = create<HeaderState>((set) => ({
  sessionContext: null,
  contextNavOverrides: {},

  setSessionContext: (ctx) => set({ sessionContext: ctx }),

  clearSessionContext: () => set({ sessionContext: null }),

  setContextNavOverride: (surfaceId, override) =>
    set((state) => ({
      contextNavOverrides: {
        ...state.contextNavOverrides,
        [surfaceId]: override,
      },
    })),

  clearContextNavOverride: (surfaceId) =>
    set((state) => {
      if (!(surfaceId in state.contextNavOverrides)) return state;
      const { [surfaceId]: _removed, ...contextNavOverrides } = state.contextNavOverrides;
      return { contextNavOverrides };
    }),
}));
