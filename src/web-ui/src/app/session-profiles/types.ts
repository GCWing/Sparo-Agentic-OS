/**
 * Session Profile type definitions.
 *
 * A SessionProfile describes all UI behavior for a given class of sessions.
 * Register profiles in SessionProfileRegistry; consume via useSessionProfile().
 */

import type { PanelContentType } from '../components/panels/base/types';

/**
 * Descriptor for a tab that a Profile wants to auto-open
 * when the matching session becomes active.
 */
export interface TabAutoOpenDescriptor {
  type: PanelContentType;
  title: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Prevent duplicate tabs of the same key. */
  duplicateCheckKey?: string;
  replaceExisting?: boolean;
}

/**
 * Full description of a session class.
 * Add fields here when a new customization axis is needed — never add
 * per-mode string checks back to individual components.
 */
export interface SessionProfile {
  /** Unique stable identifier for this profile. */
  readonly id: string;

  /**
   * Returns true when the given session mode string belongs to this profile.
   * Called by resolveProfile(); must be pure and fast.
   */
  matches(mode?: string | null): boolean;

  readonly layout: {
    /** Whether the ChatPane (conversation area) is shown. */
    showChat: boolean;
    /** Initial AuxPane visibility when a session of this type becomes active. */
    defaultAuxPane: 'collapsed' | 'visible';
    /** Whether the user may collapse/expand the chat pane. */
    chatCollapsible: boolean;
  };

  readonly auxTabs: {
    /**
     * Called when a session of this profile becomes active.
     * Return a TabAutoOpenDescriptor to auto-open a tab, or null to skip.
     */
    autoOpen?: (sessionId: string, extra?: Record<string, unknown>) => TabAutoOpenDescriptor | null;
    /**
     * Tab types that belong exclusively to this profile.
     * When switching away from this profile these tab types are closed.
     */
    exclusiveTabTypes?: readonly PanelContentType[];
  };

  readonly capabilities: {
    /** Whether the mode-switch UI (agentic/plan/debug) is available. Replaces FIXED_AGENT_MODE_IDS. */
    canSwitchModes: boolean;
    /** Whether the standard FlowChat welcome panel is shown. */
    showWelcomePanel: boolean;
    /** Whether the Dispatcher-specific model-round UI is rendered. */
    showDispatcherModelRoundUI: boolean;
  };

  readonly theme: {
    /**
     * Value written to the `data-agent` attribute on the SessionScene root div.
     * SCSS uses `[data-agent="x"]` ancestor selectors for per-agent styling.
     */
    dataAgent: string;
    /** Optional inline CSS custom-property overrides applied to the root div. */
    cssVars?: Record<string, string>;
  };

  readonly topBar: {
    /** Whether the context-nav capsule (back button + title) is shown. Replaces !isDispatcherSession. */
    showContextNav: boolean;
    /** Whether the workspace folder name is rendered beside the mode label. */
    showWorkspaceName: boolean;
  };
}
