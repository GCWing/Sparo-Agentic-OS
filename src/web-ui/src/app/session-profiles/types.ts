/**
 * Session Profile type definitions.
 *
 * A SessionProfile describes all UI behavior for a given class of sessions.
 * Register profiles in SessionProfileRegistry; consume via useSessionProfile().
 */

import type { AuxiliaryItemDescriptor } from '@/app/auxiliary-surface/types';
import type { SessionProfileId } from '@/flow_chat/domain/sessionDescriptor';
import type { Session } from '@/flow_chat/types/flow-chat';
import type { AgentSessionBindingMetadata } from '@/shared/types/session-history';

/**
 * Descriptor for a tab that a Profile wants to auto-open
 * when the matching session becomes active.
 */
export type TabAutoOpenDescriptor = AuxiliaryItemDescriptor;

export type TabAutoOpenResult =
  | TabAutoOpenDescriptor
  | readonly TabAutoOpenDescriptor[]
  | null;

export type SessionSidecarActionAvailability = 'enabled' | 'disabled' | 'hidden';

export type SessionSidecarIconId =
  | 'activity'
  | 'app-window'
  | 'file-text'
  | 'palette'
  | 'play'
  | 'settings';

export interface SessionSidecarActionDescriptor {
  /** Stable action id within a session profile. */
  id: string;
  /** Optional i18n key in the flow-chat namespace. */
  labelKey?: string;
  /** Already-resolved label, useful for app-declared tabs. */
  label?: string;
  /** Fallback label when labelKey is missing or unresolved. */
  defaultLabel: string;
  icon: SessionSidecarIconId;
  order?: number;
  availability?: SessionSidecarActionAvailability;
  panel: TabAutoOpenDescriptor;
}

export type SessionSidecarActionResult =
  | readonly SessionSidecarActionDescriptor[]
  | null;

export type SessionComposerActionAvailability = 'enabled' | 'disabled' | 'hidden';

export type SessionComposerBuiltinActionId =
  | 'attach-context'
  | 'attach-image'
  | 'skills'
  | 'btw'
  | 'goal'
  | 'compact'
  | 'init'
  | 'prompt-template';

export type SessionComposerActionProviderId =
  | 'profile'
  | 'product-app-runtime'
  | 'app-builder';

export type SessionComposerAgentSwitching =
  | { mode: 'disabled' }
  | {
      mode: 'in-session';
      /** Agent candidates are read from the active SessionDescriptor.agentPolicy. */
      source?: 'session-policy';
      /**
       * Whether to render the descriptor default agent as a switch action.
       * BitFun Coder sessions keep the default agent as the reset chip instead.
       */
      includeDefaultAgent?: boolean;
      /** Whether the current agent row should be rendered as selected. */
      showCurrentAgent?: boolean;
      /** Optional UI order for agent ids after descriptor policy validation. */
      order?: readonly string[];
    };

export interface SessionComposerPolicy {
  /** Whether the plus action surface is available in each composer state. */
  readonly visibility?: Partial<{
    showActionButtonWhenCollapsed: boolean;
    showActionButtonWhenActive: boolean;
    showActionButtonWhenProcessing: boolean;
  }>;
  /**
   * Extension point for send-with agent choices in the composer action surface.
   * The resolver still intersects this with the active session descriptor and
   * the runtime agent registry.
   */
  readonly agentSwitching?: SessionComposerAgentSwitching;
  /** Per-profile built-in action overrides. Missing keys inherit enabled. */
  readonly builtIns?: Partial<Record<SessionComposerBuiltinActionId, SessionComposerActionAvailability>>;
  /** Optional app/profile provider ids resolved after built-in providers. */
  readonly providers?: readonly SessionComposerActionProviderId[];
  /** Optional placeholder key from the flow-chat/chat-input namespace. */
  readonly placeholderKey?: string;
  /** Profile-level composer chrome. Missing values preserve standard FlowChat behavior. */
  readonly showModelSelector?: boolean;
  readonly showVoiceInput?: boolean;
  readonly showWorkspaceMeta?: boolean;
  readonly showContextUsage?: boolean;
  readonly allowContextInput?: boolean;
}

/**
 * Per-profile visibility for actions attached to persisted chat messages.
 * Copy remains universally available; these switches cover actions that
 * mutate conversation history or branch/export it into another surface.
 */
export interface SessionMessageActionPolicy {
  readonly showUserEdit?: boolean;
  readonly showUserRecovery?: boolean;
  readonly showUserRollback?: boolean;
  readonly showAssistantFork?: boolean;
  readonly showAssistantExport?: boolean;
}

export interface SessionAgentContextHint {
  systemReminder?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Full description of a session class.
 * Add fields here when a new customization axis is needed; never add
 * per-mode string checks back to individual components.
 */
export interface SessionProfile {
  /** Unique stable identifier for this profile. */
  readonly id: SessionProfileId;

  readonly auxiliarySurface: {
    /** Initial visibility when this profile first contributes content to a host. */
    defaultVisibility: 'collapsed' | 'visible';
    /**
     * Called once when a ready session first initializes its auxiliary host.
     */
    initialize?: (sessionId: string, extra?: Record<string, unknown>) => TabAutoOpenResult;
    /**
     * Rebuild the profile-owned default items after the user closed every tab.
     * Unlike initialize, this may be called more than once for the same host.
     */
    restore?: (sessionId: string, extra?: Record<string, unknown>) => TabAutoOpenResult;
  };

  /**
   * Header actions that open profile-owned right-side sidecar panels.
   * This is the extension point for app/agent-specific preview panels.
   */
  readonly sidecarActions?: (
    sessionId: string,
    extra?: Record<string, unknown>
  ) => SessionSidecarActionResult;

  readonly buildAgentContextHint?: (
    session: Session,
    binding: AgentSessionBindingMetadata
  ) => SessionAgentContextHint | null;

  /**
   * Composer action surface policy: plus menu, slash command exposure, and
   * send-with actions are resolved from this capability instead of component
   * local mode checks.
   */
  readonly composer?: SessionComposerPolicy;

  readonly messageActions?: SessionMessageActionPolicy;

  readonly capabilities: {
    /** Whether the standard FlowChat welcome panel is shown. */
    showWelcomePanel: boolean;
    /** Whether the Agentic OS-specific model-round UI is rendered. */
    showAgenticOsModelRoundUI: boolean;
    /** Whether the first user message may replace the session title. */
    autoTitle?: boolean;
    /** Runtime-owned model selection is authoritative and must not be synchronized by FlowChat. */
    modelSelection?: 'session-managed' | 'runtime-owned';
  };

  readonly workspaceScope: {
    /**
     * How this profile relates to project workspaces.
     * `workspace` means the session is anchored to a project directory.
     * `global` means the session is system/app scoped, so workspace labels should render as global.
     */
    kind: 'workspace' | 'global';
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
    /** Whether the context-nav capsule (back button + title) is shown. Replaces !isAgenticOsSession. */
    showContextNav: boolean;
    /** Whether the workspace folder name is rendered beside the mode label. */
    showWorkspaceName: boolean;
  };
}
