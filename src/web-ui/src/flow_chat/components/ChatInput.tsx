/**
 * Standalone chat input component
 * Separated from bottom bar, supports session-level state awareness
 */

import React, { useRef, useCallback, useEffect, useLayoutEffect, useReducer, useState, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useContextStore } from '../../shared/context-system';
import type {
  ComposerIngressContext,
  MentionState,
  RichTextInputHandle,
} from './RichTextInput';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { shortcutManager } from '@/infrastructure/services/ShortcutManager';
import {
  useSessionDerivedState,
  useSessionStateMachineActions,
} from '../hooks/useSessionStateMachine';
import { ModelSelector } from './ModelSelector';
import type {
  SkillSelectionContext,
  TextFragmentContext,
  URLContext,
} from '../../shared/types/context';
import {
  getComposerText,
  hasComposerContent,
  hasSendableComposerDraft,
} from '../../shared/types/composer';
import {
  createComposerContextSnapshot,
} from '../domain/composerContextRegistry';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { inputReducer, initialInputState } from '../reducers/inputReducer';
import { agentReducer, initialAgentState } from '../reducers/agentReducer';
import {
  useMessageSender,
  type ResolveMessageSendContext,
} from '../hooks/useMessageSender';
import { CHAT_INPUT_CONFIG } from '../constants/chatInputConfig';
import { useInputHistoryStore } from '../store/inputHistoryStore';
import { useSessionTurnQueueStore } from '../store/sessionTurnQueueStore';
import { useSessionProfile } from '@/app/session-profiles';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { resolveComposerActionModel } from './composer/actions/composerActionResolver';
import type { ComposerActionDescriptor } from './composer/actions/composerActionTypes';
import { ComposerActions } from './composer/ComposerActions';
import { ComposerActionMenu } from './composer/ComposerActionMenu';
import { ComposerEditorArea } from './composer/ComposerEditorArea';
import { ComposerIntentRail } from './composer/ComposerIntentRail';
import { ComposerSpreadsheetFocusRail } from './composer/ComposerSpreadsheetFocusRail';
import { ComposerSendAction } from './composer/ComposerSendAction';
import { ComposerShell } from './composer/ComposerShell';
import { useComposerLayout } from './composer/hooks/useComposerLayout';
import { useComposerBoostActions } from './composer/hooks/useComposerBoostActions';
import { useComposerBoostSkills } from './composer/hooks/useComposerBoostSkills';
import { useComposerCommandInteraction } from './composer/hooks/useComposerCommandInteraction';
import { useComposerCommandOptions } from './composer/hooks/useComposerCommandOptions';
import { useComposerExternalEvents } from './composer/hooks/useComposerExternalEvents';
import { useComposerHeightObserver } from './composer/hooks/useComposerHeightObserver';
import { useComposerInputActions } from './composer/hooks/useComposerInputActions';
import { useComposerInputDetection } from './composer/hooks/useComposerInputDetection';
import { useComposerIntent } from './composer/hooks/useComposerIntent';
import { useComposerInputLifecycle } from './composer/hooks/useComposerInputLifecycle';
import { useComposerKeyboard } from './composer/hooks/useComposerKeyboard';
import { useComposerMediaInput } from './composer/hooks/useComposerMediaInput';
import { useComposerMcpPromptCommands } from './composer/hooks/useComposerMcpPromptCommands';
import { useComposerAgentActions } from './composer/hooks/useComposerAgentActions';
import { useComposerAgentSync } from './composer/hooks/useComposerAgentSync';
import { useComposerOutsideInteractions } from './composer/hooks/useComposerOutsideInteractions';
import { useComposerQueuedInputRestore } from './composer/hooks/useComposerQueuedInputRestore';
import { useComposerRecommendations } from './composer/hooks/useComposerRecommendations';
import { useComposerSessionTarget } from './composer/hooks/useComposerSessionTarget';
import { useComposerSubmission } from './composer/hooks/useComposerSubmission';
import { useComposerTokenUsage } from './composer/hooks/useComposerTokenUsage';
import { ComposerVoiceInputButton } from './composer/voice/ComposerVoiceInputButton';
import { useComposerVoiceInput } from './composer/voice/useComposerVoiceInput';
import { ComposerHandoffStatus } from './composer/ComposerHandoffStatus';
import { ComposerQueueTray } from './composer/ComposerQueueTray';
import {
  CLOSED_COMPOSER_COMMAND_INTERACTION,
  type ChatInputTarget,
  type ComposerCommandInteractionState,
} from './composer/model/composerState';
import {
  getComposerCommandTokenKey,
  NO_COMPOSER_INPUT_DETECTION,
  type ComposerInputDetection,
} from './composer/model/composerInputDetection';
import {
  composerSessionTargetFromIntent,
} from './composer/model/composerIntentState';
import type { ComposerCommandContext } from './composer/model/composerCommandRegistry';
import { resolveComposerSessionProfile } from './composer/model/composerSessionProfile';
import { deriveComposerOsHandoffState } from '../domain/osHandoffIntent';
import { supportsSessionGoal } from '../domain/goalSupport';
import { useSessionGoalSnapshot } from '../store/sessionGoalStore';
import { workspacePathFromAppScope } from '@/shared/types/app-scope';
import './ChatInput.scss';

export interface ChatInputProps {
  className?: string;
  targetSessionId?: string | null;
  active?: boolean;
  resolveSendContext?: ResolveMessageSendContext;
  onSendMessage?: (message: string) => void;
  onDispatchComposerAppAction?: (action: {
    providerId: string;
    actionId: string;
    payload?: unknown;
  }) => void;
}

function shouldIgnoreGlobalActivateTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  if (
    target.classList.contains('monaco-editor') ||
    target.classList.contains('inputarea') ||
    target.closest('.monaco-editor') !== null
  ) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) {
    const style = window.getComputedStyle(target);
    if (style.display !== 'none' && style.visibility !== 'hidden') return true;
  }

  if (
    target.classList.contains('sparo-chat-input') ||
    target.classList.contains('rich-text-input') ||
    target.closest('.sparo-chat-input') !== null ||
    target.closest('.rich-text-input') !== null
  ) {
    return true;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) return true;

  const role = target.getAttribute('role') ?? target.closest('[role]')?.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton';
}

function formatContextPercent(percent: number): string {
  if (percent <= 0) return '0';
  if (percent < 0.1) return '<0.1';
  if (percent < 10) return percent.toFixed(1);
  return percent.toFixed(0);
}

export const ChatInput: React.FC<ChatInputProps> = ({
  className = '',
  targetSessionId,
  active = true,
  resolveSendContext,
  onSendMessage,
  onDispatchComposerAppAction,
}) => {
  const { t } = useTranslation('flow-chat');
  const { t: tChatInput } = useTranslation('flow-chat/chat-input');

  const [inputState, dispatchInput] = useReducer(inputReducer, initialInputState);
  const [modeState, dispatchMode] = useReducer(agentReducer, initialAgentState);

  const richTextInputRef = useRef<RichTextInputHandle>(null);
  const voiceSubmitRef = useRef<() => Promise<void>>(async () => undefined);
  const agentBoostRef = useRef<HTMLDivElement>(null);
  const isImeComposingRef = useRef(false);
  // Ref so the queuedInput sync effect can read the latest value without it being a dep
  const inputValueRef = useRef('');

  // History navigation state
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState<ReturnType<typeof createComposerContextSnapshot> | null>(null);
  const [isAwakening, setIsAwakening] = useState(false);
  const { addMessage: addToHistory, getSessionHistory } = useInputHistoryStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    intent: composerIntent,
    intentActions,
    applyCommandOption,
    hasSubmitIntent,
  } = useComposerIntent();
  const inputTarget = composerSessionTargetFromIntent(composerIntent.target);
  const setComposerTarget = useCallback((
    target: ChatInputTarget | ((previous: ChatInputTarget) => ChatInputTarget),
  ) => {
    const previous = composerSessionTargetFromIntent(composerIntent.target);
    const next = typeof target === 'function' ? target(previous) : target;
    intentActions.setTarget(next === 'btw' ? 'btw-thread' : 'main');
  }, [composerIntent.target, intentActions]);

  const assets = useContextStore(state => state.assets);
  const references = useContextStore(state => state.references);
  const composerDocument = useContextStore(state => state.document);
  const resolveAttachment = useContextStore(state => state.resolveAttachment);
  const resolveAttachmentReference = useContextStore(state => state.resolveAttachmentReference);
  const attachmentActivity = useContextStore(state => state.attachmentActivity);
  const createAttachmentReference = useContextStore(state => state.createAttachmentReference);
  const removeAttachment = useContextStore(state => state.removeAttachment);
  const removeReference = useContextStore(state => state.removeReference);
  const clearDraft = useContextStore(state => state.clearDraft);
  const replaceDraftText = useContextStore(state => state.replaceDraftText);
  const restoreDraft = useContextStore(state => state.restoreDraft);
  const restoreDraftIfEmpty = useContextStore(state => state.restoreDraftIfEmpty);
  const setActiveDraft = useContextStore(state => state.setActiveDraft);
  const setComposerDocument = useContextStore(state => state.setDocument);
  const updateContext = useContextStore(state => state.updateContext);

  const { isInputMultiline } = useComposerLayout({
    editorRef: richTextInputRef,
    value: inputState.value,
    attachmentCount: assets.length,
  });

  const { profile: surfaceProfile } = useSessionProfile();
  const {
    activeSessionDescriptor,
    currentSessionId,
    currentSessionModelId,
    effectiveTargetSession,
    effectiveTargetSessionId,
    isBtwSession,
    showTargetSwitcher,
  } = useComposerSessionTarget({
    explicitSessionId: targetSessionId,
    inputTarget,
    setInputTarget: setComposerTarget,
    t,
  });
  const profile = useMemo(
    () => resolveComposerSessionProfile({
      surfaceProfile,
      targetDescriptor: activeSessionDescriptor,
    }),
    [activeSessionDescriptor, surfaceProfile],
  );
  const composerDraftKey = useMemo(
    () => `composer:${effectiveTargetSessionId || currentSessionId || targetSessionId || 'new'}`,
    [currentSessionId, effectiveTargetSessionId, targetSessionId],
  );
  useLayoutEffect(() => {
    setActiveDraft(composerDraftKey);
  }, [composerDraftKey, setActiveDraft]);

  useEffect(() => {
    const text = getComposerText(composerDocument);
    if (inputValueRef.current === text) return;
    inputValueRef.current = text;
    dispatchInput({ type: 'SET_VALUE', payload: text });
  }, [composerDocument]);
  const queuedTurnCount = useSessionTurnQueueStore(state =>
    effectiveTargetSessionId ? state.queuesBySession[effectiveTargetSessionId]?.length ?? 0 : 0
  );
  const queuePause = useSessionTurnQueueStore(state =>
    effectiveTargetSessionId ? state.pauseBySession[effectiveTargetSessionId] : undefined
  );
  const refreshTurnQueue = useSessionTurnQueueStore(state => state.refreshQueue);
  useEffect(() => {
    if (!effectiveTargetSessionId) return;
    void refreshTurnQueue(effectiveTargetSessionId);
  }, [effectiveTargetSessionId, refreshTurnQueue]);
  const hasQueueActivity = queuedTurnCount > 0 || Boolean(queuePause);
  // Memoize history so keyboard handlers don't see a fresh [] on every render.
  const inputHistory = useMemo(
    () => (effectiveTargetSessionId ? getSessionHistory(effectiveTargetSessionId) : []),
    [effectiveTargetSessionId, getSessionHistory],
  );
  const composerHasSendablePayload = hasSendableComposerDraft(composerDocument, assets);
  const derivedState = useSessionDerivedState(
    effectiveTargetSessionId,
    composerHasSendablePayload,
  );
  const { transition, setQueuedInput } = useSessionStateMachineActions(effectiveTargetSessionId);

  const { workspacePath } = useLastUsedWorkspace();

  const tokenUsage = useComposerTokenUsage(effectiveTargetSessionId);
  const contextUsagePercent = tokenUsage.max > 0
    ? Math.min(999, Math.max(0, (tokenUsage.current / tokenUsage.max) * 100))
    : 0;
  const contextUsagePercentText = formatContextPercent(contextUsagePercent);
  const ProductAppRuntimeWorkspacePath = workspacePathFromAppScope(
    effectiveTargetSession?.customMetadata?.productAppRuntime?.scope
  );
  const sessionWorkspacePath =
    effectiveTargetSession?.workspacePath?.trim() ||
    ProductAppRuntimeWorkspacePath ||
    '';
  const workspaceScopeKind =
    profile.workspaceScope.kind === 'global' && ProductAppRuntimeWorkspacePath
      ? 'workspace'
      : profile.workspaceScope.kind;
  const workspaceMeta = useMemo(() => {
    if (workspaceScopeKind === 'global') {
      return t('input.globalWorkspace', { defaultValue: 'Global' });
    }

    return (
      sessionWorkspacePath ||
      workspacePath ||
      t('input.globalWorkspace', { defaultValue: 'Global' })
    );
  }, [
    sessionWorkspacePath,
    t,
    workspacePath,
    workspaceScopeKind,
  ]);
  const contextUsageMeta = tokenUsage.snapshot
    ? `${contextUsagePercentText}%`
    : tokenUsage.current > 0
      ? `${contextUsagePercentText}%`
      : t('input.contextUsageLoading', { defaultValue: 'Context' });
  const currentAgent = modeState.current;
  const workspaceFilesTargetPath = workspaceScopeKind === 'global'
    ? null
    : (sessionWorkspacePath || workspacePath || null);
  const effectiveWorkspacePath = sessionWorkspacePath || workspacePath || null;
  const supportsGoalForComposer = supportsSessionGoal({
    workspacePath: effectiveWorkspacePath,
    workspaceScopeKind,
    domain: effectiveTargetSession?.domain,
    descriptor: effectiveTargetSession?.descriptor,
    agentId: currentAgent,
  });
  const commandContext = useMemo<ComposerCommandContext>(() => ({
    currentAgent,
    hasCurrentSession: Boolean(currentSessionId),
    hasTargetSession: Boolean(effectiveTargetSessionId),
    isBtwSession,
    isProcessing: Boolean(derivedState?.isProcessing),
    supportsGoal: supportsGoalForComposer,
  }), [
    currentAgent,
    currentSessionId,
    derivedState?.isProcessing,
    effectiveTargetSessionId,
    isBtwSession,
    supportsGoalForComposer,
  ]);
  const handleOpenWorkspaceFiles = useCallback(() => {
    openWorkspaceScene('file-viewer', { workspacePath: workspaceFilesTargetPath });
  }, [workspaceFilesTargetPath]);

  const {
    boostSkillUnits,
    boostSkillsLoading,
    closeSkillsFlyout,
    dismissSkillsFlyout,
    handleSkillsListScroll,
    openSkillsFlyout,
    setSkillsFlyoutOpen,
    skillsFlyoutLeft,
    skillsFlyoutOpen,
    skillsFlyoutUp,
    skillsHostRef,
    skillsTooltipSuppressed,
  } = useComposerBoostSkills({
    dropdownOpen: modeState.dropdownOpen,
    workspacePath: effectiveWorkspacePath ?? undefined,
    agentId: currentAgent,
  });
  const selectedSkillCommands = useMemo(
    () => new Set(assets
      .filter((context): context is SkillSelectionContext => context.type === 'skill-selection')
      .map(context => context.command)),
    [assets],
  );

  useComposerHeightObserver(containerRef);
  useComposerInputLifecycle({
    effectiveTargetSessionId,
    isActive: inputState.isActive,
    isExpanded: inputState.isExpanded,
    setHistoryIndex,
  });

  const { sendMessage } = useMessageSender({
    currentSessionId: effectiveTargetSessionId || undefined,
    contexts: assets,
    onSuccess: onSendMessage,
    // Composer agent is authoritative, synced from the session descriptor.
    currentAgentType: modeState.current,
    resolveSendContext,
  });

  const {
    loadMcpPromptCommands,
    mcpPromptCommands,
    mcpPromptCommandsLoading,
  } = useComposerMcpPromptCommands();
  const composerActionModel = useMemo(() => resolveComposerActionModel({
    t,
    profile,
    descriptor: activeSessionDescriptor,
    targetSessionId: effectiveTargetSessionId ?? null,
    workspacePath: effectiveWorkspacePath,
    domain: effectiveTargetSession?.domain,
    customMetadata: effectiveTargetSession?.customMetadata,
    availableAgents: modeState.available,
    currentAgent,
    isComposerActive: inputState.isActive,
    hasCurrentSession: Boolean(currentSessionId),
    hasTargetSession: Boolean(effectiveTargetSessionId),
    isBtwSession,
    isProcessing: Boolean(derivedState?.isProcessing),
    supportsGoal: supportsGoalForComposer,
    mcpPromptCommands,
  }), [
    activeSessionDescriptor,
    currentAgent,
    currentSessionId,
    derivedState?.isProcessing,
    effectiveTargetSession?.customMetadata,
    effectiveTargetSession?.domain,
    effectiveTargetSessionId,
    effectiveWorkspacePath,
    inputState.isActive,
    isBtwSession,
    mcpPromptCommands,
    modeState.available,
    profile,
    supportsGoalForComposer,
    t,
  ]);
  const canSwitchAgents = composerActionModel.canSwitchAgents;
  const switchableAgents = composerActionModel.switchableAgents;
  const defaultAgentId = composerActionModel.defaultAgentId;
  const recommendationContext = useComposerRecommendations({
    effectiveTargetSessionId,
    isProcessing: !!derivedState?.isProcessing,
    workspacePath: effectiveWorkspacePath ?? undefined,
  });

  const [mentionState, setMentionState] = useState<MentionState>({
    isActive: false,
    query: '',
    startOffset: 0,
  });

  const [inputDetection, setInputDetection] = useState<ComposerInputDetection>(
    NO_COMPOSER_INPUT_DETECTION,
  );
  const [commandState, setCommandState] = useState<ComposerCommandInteractionState>(
    CLOSED_COMPOSER_COMMAND_INTERACTION,
  );
  const slashCommandTokenKey = useMemo(
    () => getComposerCommandTokenKey(inputDetection),
    [inputDetection],
  );
  const activeGoalSnapshot = useSessionGoalSnapshot(effectiveTargetSessionId);
  const useStackedComposerLayout = isInputMultiline;

  const {
    commandOptions,
    resolveCommandOption,
  } = useComposerCommandOptions({
    actions: composerActionModel.actions,
    commandContext,
    commandState,
    inputDetection,
    loadMcpPromptCommands,
  });

  const createTextFragment = useCallback((text: string): ComposerIngressContext | null => {
    if (profile.composer?.allowContextInput === false) return null;
    const trimmed = text.trim();
    try {
      const parsed = new URL(trimmed);
      if (trimmed === parsed.href || trimmed === parsed.href.replace(/\/$/, '')) {
        const asset: URLContext = {
          id: typeof globalThis.crypto?.randomUUID === 'function'
            ? `url-${globalThis.crypto.randomUUID()}`
            : `url-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          type: 'url',
          timestamp: Date.now(),
          url: parsed.href,
          title: parsed.hostname,
        };
        const resolution = resolveAttachmentReference(asset);
        if (resolution.kind === 'rejected') return null;
        return { asset: resolution.asset, reference: resolution.reference };
      }
    } catch {
      // Plain text continues through the normal paste path.
    }
    const charCount = Array.from(text).length;
    if (charCount <= CHAT_INPUT_CONFIG.largePaste.thresholdChars) return null;
    const asset: TextFragmentContext = {
      id: typeof globalThis.crypto?.randomUUID === 'function'
        ? `text-fragment-${globalThis.crypto.randomUUID()}`
        : `text-fragment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      type: 'text-fragment',
      timestamp: Date.now(),
      content: text,
      charCount,
      source: 'clipboard',
      format: 'markdown',
    };
    const resolution = resolveAttachmentReference(asset);
    if (resolution.kind === 'rejected') return null;
    return { asset: resolution.asset, reference: resolution.reference };
  }, [profile.composer?.allowContextInput, resolveAttachmentReference]);
  const currentComposerSnapshot = useMemo(
    () => createComposerContextSnapshot(composerDocument, references, assets),
    [assets, composerDocument, references],
  );
  const updateDraftContext = useCallback((
    id: string,
    updates: Parameters<typeof updateContext>[2],
  ) => {
    updateContext(composerDraftKey, id, updates);
  }, [composerDraftKey, updateContext]);

  const {
    activateComposerInput,
    clearComposerInput,
    focusRichTextInputSoon,
    handleActivate,
    handleDropContextAdded,
    isBtwShortcutBlocked,
    resetHistoryDraft,
    setComposerInputValue,
  } = useComposerInputActions({
    currentSessionId,
    dispatchInput,
    inputIsActive: inputState.isActive,
    inputValueRef,
    isBtwSession,
    richTextInputRef,
    replaceDraftText,
    clearDraft,
    resolveAttachmentReference,
    setHistoryIndex,
    setSavedDraft,
    t,
  });
  const restoreComposerSnapshot = useCallback((snapshot: typeof currentComposerSnapshot) => {
    restoreDraft(snapshot.document, snapshot.assets, snapshot.references);
    const text = getComposerText(snapshot.document);
    dispatchInput({ type: 'SET_VALUE', payload: text });
    inputValueRef.current = text;
    activateComposerInput();
    focusRichTextInputSoon();
  }, [activateComposerInput, focusRichTextInputSoon, restoreDraft]);

  const insertVoiceInputText = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const editor = richTextInputRef.current;
    const currentValue = editor?.getPlainText() ?? inputValueRef.current;
    const prefix = currentValue.trim().length > 0 && !/\s$/.test(currentValue) ? ' ' : '';
    flushSync(() => {
      if (editor) {
        editor.insertText(`${prefix}${trimmed}`);
      } else {
        setComposerInputValue(`${currentValue}${prefix}${trimmed}`);
      }
    });
    return true;
  }, [setComposerInputValue]);

  useComposerAgentSync({
    activeSessionDescriptor,
    dispatchMode,
    explicitTargetSessionId: targetSessionId,
    effectiveTargetSessionId,
    allowGlobalAgentSync: profile.composer?.agentSwitching?.mode !== 'disabled',
  });

  useComposerQueuedInputRestore({
    replaceDraftText,
    dispatchInput,
    effectiveTargetSessionId,
    inputValueRef,
    queuedInput: derivedState?.queuedInput,
    richTextInputRef,
  });

  const shouldQueueDraft = useCallback((text: string) => {
    if (!derivedState?.isProcessing) return false;
    if (composerIntent.target === 'btw-draft') return false;
    if (composerIntent.operation) return false;
    if (composerIntent.modifiers.includes('goal')) return false;
    return text.trim().length > 0;
  }, [composerIntent.modifiers, composerIntent.operation, composerIntent.target, derivedState?.isProcessing]);

  const handleInputChange = useComposerInputDetection({
    references,
    derivedState: derivedState ?? null,
    dispatchInput,
    inputIsActive: inputState.isActive,
    inputValueRef,
    isImeComposingRef,
    setDocument: setComposerDocument,
    removeReference,
    setInputDetection,
    setQueuedInput,
    shouldQueueDraft,
  });

  const {
    applyAgentChange,
    requestAgentChange,
  } = useComposerAgentActions({
    canSwitchAgents,
    currentAgent,
    dispatchMode,
    effectiveTargetSessionId,
    switchableAgents,
  });

  const {
    closeCommandPicker,
    moveCommandSelection,
    selectCommandOption,
    selectCurrentCommandOption,
  } = useComposerCommandInteraction({
    applyCommandOption,
    commandOptions,
    commandState,
    focusInputSoon: focusRichTextInputSoon,
    inputDetection,
    inputValue: inputState.value,
    onSwitchAgent: requestAgentChange,
    onDispatchAppAction: onDispatchComposerAppAction,
    resolveCommandOption,
    setCommandState,
    setInputDetection,
    setInputValue: setComposerInputValue,
    setQueuedInput,
  });

  const handleImeCompositionStart = useCallback(() => {
    isImeComposingRef.current = true;
  }, []);

  const handleImeCompositionEnd = useCallback(() => {
    isImeComposingRef.current = false;
  }, []);

  const handleImageInput = useComposerMediaInput({
    resolveAttachment,
    activateInput: activateComposerInput,
    t,
  });

  const toggleExpand = useCallback(() => {
    dispatchInput({ type: 'TOGGLE_EXPAND' });
  }, []);

  useComposerExternalEvents({
    editorRef: richTextInputRef,
    inputValue: inputState.value,
    inputValueRef,
    isActive: inputState.isActive,
    activateInput: activateComposerInput,
    setInputValue: setComposerInputValue,
    setInputTarget: setComposerTarget,
    resolveAttachment,
    resolveAttachmentReference,
    restoreComposerSnapshot,
    enabled: active,
    allowContextInput: profile.composer?.allowContextInput !== false,
    targetSessionId: effectiveTargetSessionId,
    t,
  });

  const playAwakeningMotion = useCallback(() => {
    if (inputState.isActive) return;
    setIsAwakening(true);
  }, [inputState.isActive]);

  useEffect(() => {
    if (!isAwakening) return;
    const timeout = window.setTimeout(() => setIsAwakening(false), 520);
    return () => window.clearTimeout(timeout);
  }, [isAwakening]);

  useShortcut(
    'chat.activateInput',
    { key: ' ', scope: 'chat' },
    () => {
      playAwakeningMotion();
      activateComposerInput();
      focusRichTextInputSoon();
    },
    {
      priority: 10,
      description: 'keyboard.shortcuts.chat.activateInput',
      enabled: active,
    },
  );

  useEffect(() => {
    if (!active) return;
    const handleGlobalActivate = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!shortcutManager.matchesShortcutId('chat.activateInput', { key: ' ', scope: 'chat' }, event)) {
        return;
      }
      if (shouldIgnoreGlobalActivateTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      playAwakeningMotion();
      activateComposerInput();
      focusRichTextInputSoon();
    };

    window.addEventListener('keydown', handleGlobalActivate, true);
    return () => window.removeEventListener('keydown', handleGlobalActivate, true);
  }, [active, activateComposerInput, focusRichTextInputSoon, playAwakeningMotion]);

  const {
    handleCancelGeneration,
    handleSendOrCancel,
  } = useComposerSubmission({
    t,
    intent: composerIntent,
    inputValue: inputState.value,
    setInputValue: setComposerInputValue,
    activateInput: activateComposerInput,
    clearInput: clearComposerInput,
    setQueuedInput,
    resetIntentAfterSubmit: intentActions.resetTransient,
    currentSessionId,
    currentSessionModelId,
    effectiveTargetSessionId,
    effectiveTargetSession,
    workspacePath,
    isBtwSession,
    derivedState: derivedState ?? null,
    transition,
    sendMessage,
    addToHistory,
    resetHistoryDraft,
    onSendMessage,
    document: composerDocument,
    assets,
    references,
    restoreDraft,
    restoreDraftIfEmpty,
    updateDraftContext,
    draftKey: composerDraftKey,
    activeGoalId: activeGoalSnapshot.goal?.goalId,
    onBtwStarted: () => intentActions.setTarget('btw-thread'),
  });

  voiceSubmitRef.current = handleSendOrCancel;
  const voiceInputController = useComposerVoiceInput({
    activateInput: activateComposerInput,
    focusInputSoon: focusRichTextInputSoon,
    insertText: insertVoiceInputText,
    submitText: () => voiceSubmitRef.current(),
  });

  const handleKeyDown = useComposerKeyboard({
    editorRef: richTextInputRef,
    isImeComposingRef,
    commandPickerOpen: commandState.isOpen,
    commandOptionCount: commandOptions.length,
    moveCommandSelection,
    selectCurrentCommandOption,
    closeCommandPicker,
    showTargetSwitcher,
    setInputTarget: setComposerTarget,
    inputHistory,
    historyIndex,
    setHistoryIndex,
    savedDraft,
    setSavedDraft,
    currentDraft: currentComposerSnapshot,
    restoreDraft: restoreComposerSnapshot,
    hasContent: hasComposerContent(composerDocument) || assets.length > 0,
    setInputValue: setComposerInputValue,
    activateInput: activateComposerInput,
    focusInputSoon: focusRichTextInputSoon,
    onBtwShortcutBlocked: isBtwShortcutBlocked,
    onBtwShortcutDraft: (draft) => {
      intentActions.setTarget('btw-draft');
      setComposerInputValue(draft);
    },
    handleSendOrCancel: () => {
      void handleSendOrCancel();
    },
    hasSubmitIntent,
    derivedState: derivedState ?? null,
    cancelGeneration: () => {
      void handleCancelGeneration();
    },
  });

  const {
    handleBoostOpenAtContext,
    handleBoostPickImage,
    handleBoostStartBtw,
    handleOpenSkillsLibrary,
    insertSkillIntoInput,
  } = useComposerBoostActions({
    currentSessionId,
    dismissSkillsFlyout,
    dispatchInput,
    dispatchMode,
    contexts: assets,
    resolveAttachmentReference,
    removeAttachment,
    focusInputSoon: focusRichTextInputSoon,
    handleImageInput,
    isBtwSession,
    onStartSideQuestionDraft: () => intentActions.setTarget('btw-draft'),
    richTextInputRef,
    t,
  });

  const handleComposerActionSelect = useCallback((
    action: ComposerActionDescriptor,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation();
    if (action.availability.state !== 'enabled') return;

    switch (action.select.type) {
      case 'open-context-picker':
        handleBoostOpenAtContext(event);
        break;
      case 'pick-image':
        handleBoostPickImage(event);
        break;
      case 'set-target':
        if (action.select.target === 'btw-draft') {
          handleBoostStartBtw(event);
        } else {
          intentActions.setTarget(action.select.target);
          dispatchMode({ type: 'CLOSE_DROPDOWN' });
          focusRichTextInputSoon();
        }
        break;
      case 'add-modifier':
        intentActions.addModifier(action.select.modifier);
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        focusRichTextInputSoon();
        break;
      case 'set-operation':
        intentActions.setOperation(action.select.operation);
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        focusRichTextInputSoon();
        break;
      case 'switch-agent':
        requestAgentChange(action.select.agentId);
        break;
      case 'set-prompt-template':
        intentActions.setPromptTemplate(action.select.prompt);
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        focusRichTextInputSoon();
        break;
      case 'dispatch-app-action':
        onDispatchComposerAppAction?.({
          providerId: action.select.providerId,
          actionId: action.select.actionId,
          payload: action.select.payload,
        });
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        focusRichTextInputSoon();
        break;
      case 'open-skills-flyout':
      default:
        break;
    }
  }, [
    dispatchMode,
    focusRichTextInputSoon,
    handleBoostOpenAtContext,
    handleBoostPickImage,
    handleBoostStartBtw,
    intentActions,
    onDispatchComposerAppAction,
    requestAgentChange,
  ]);

  useComposerOutsideInteractions({
    agentBoostRef,
    containerRef,
    dispatchMode,
    dropdownOpen: modeState.dropdownOpen,
    slashCommandOpen: commandState.isOpen,
    slashCommandTokenKey,
    setSkillsFlyoutOpen,
    setCommandState,
  });

  const isCollapsedProcessing = !inputState.isActive && !!derivedState?.isProcessing;
  const composerHandoffState = deriveComposerOsHandoffState(effectiveTargetSession);

  const getAgentDisplayName = useCallback((agent: { id: string; name: string } | string) => {
    if (typeof agent === 'string') {
      return tChatInput(`agentNames.${agent}`, { defaultValue: '' }) ||
        modeState.available.find(item => item.id === agent)?.name ||
        agent;
    }
    return tChatInput(`agentNames.${agent.id}`, { defaultValue: '' }) || agent.name;
  }, [modeState.available, tChatInput]);
  const selectedAgentLabel = canSwitchAgents && modeState.current !== defaultAgentId
    ? getAgentDisplayName(modeState.current) || modeState.current
    : null;

  const handleResetAgentFromChip = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    applyAgentChange(defaultAgentId);
    dispatchMode({ type: 'CLOSE_DROPDOWN' });
  }, [applyAgentChange, defaultAgentId, dispatchMode]);

  const handleToggleComposerTarget = useCallback(() => {
    setComposerTarget(previous => previous === 'main' ? 'btw' : 'main');
  }, [setComposerTarget]);

  const editorArea = (
    <div className="sparo-chat-input__message-row">
      <ComposerIntentRail
        intent={composerIntent}
        activeGoalSnapshot={activeGoalSnapshot}
        inputTarget={inputTarget}
        showTargetToggle={showTargetSwitcher}
        labels={{
          remove: tChatInput('intentChips.remove', { defaultValue: 'Remove' }),
          targetMain: tChatInput('targetMain', { defaultValue: 'Main' }),
          targetBtwDraft: tChatInput('intentChips.targetBtwDraft', { defaultValue: 'Side question' }),
          targetBtwThread: tChatInput('intentChips.targetBtwThread', { defaultValue: 'Side session' }),
          goalDraft: tChatInput('intentChips.goalDraft', { defaultValue: 'Goal mode' }),
          goalActive: tChatInput('intentChips.goalActive', { defaultValue: 'Goal active' }),
          goalPaused: tChatInput('intentChips.goalPaused', { defaultValue: 'Goal paused' }),
          goalPending: tChatInput('intentChips.goalPending', { defaultValue: 'Goal pending' }),
          operationCompact: tChatInput('compactAction', { defaultValue: 'Compact session' }),
          operationInit: tChatInput('initAction', { defaultValue: 'Generate AGENTS.md' }),
          promptTemplate: tChatInput('intentChips.promptTemplate', { defaultValue: 'Prompt' }),
        }}
        onClearTarget={() => intentActions.setTarget('main')}
        onToggleTarget={handleToggleComposerTarget}
        onClearGoalModifier={() => intentActions.removeModifier('goal')}
        onClearOperation={intentActions.clearOperation}
        onClearPromptTemplate={intentActions.clearPromptTemplate}
      />
      <ComposerSpreadsheetFocusRail
        sessionId={effectiveTargetSessionId}
        labels={{
          included: tChatInput('spreadsheetFocus.included', { defaultValue: 'Spreadsheet focus included' }),
          excluded: tChatInput('spreadsheetFocus.excluded', { defaultValue: 'Spreadsheet focus excluded' }),
          includeAction: tChatInput('spreadsheetFocus.includeAction', { defaultValue: 'Include with next message' }),
          excludeAction: tChatInput('spreadsheetFocus.excludeAction', { defaultValue: 'Exclude from next message' }),
          partialCache: tChatInput('spreadsheetFocus.partialCache', { defaultValue: 'Selection preview is incomplete' }),
          staleFormulas: tChatInput('spreadsheetFocus.staleFormulas', { defaultValue: 'Formula results are stale' }),
          modes: {
            inspect: tChatInput('spreadsheetFocus.modes.inspect', { defaultValue: 'Inspect' }),
            edit: tChatInput('spreadsheetFocus.modes.edit', { defaultValue: 'Edit' }),
            author: tChatInput('spreadsheetFocus.modes.author', { defaultValue: 'Author' }),
          },
        }}
      />
      <ComposerEditorArea
        editorRef={richTextInputRef}
        document={composerDocument}
        draftKey={composerDraftKey}
        assets={assets}
        references={references}
        attachmentActivity={attachmentActivity?.draftKey === composerDraftKey
          ? attachmentActivity
          : null}
        mentionState={mentionState}
        workspacePath={effectiveWorkspacePath ?? undefined}
        commandState={commandState}
        commandOptions={commandOptions}
        mcpPromptCommandsLoading={mcpPromptCommandsLoading}
        labels={{
          placeholder: profile.composer?.placeholderKey
            ? tChatInput(profile.composer.placeholderKey)
            : t('input.placeholder'),
          spaceToActivate: (
            <Trans
              t={t}
              i18nKey="input.spaceToActivate"
              components={{
                space: <span className="sparo-chat-input__space-key" />,
              }}
            />
          ),
          commands: tChatInput('composerCommands.title', { defaultValue: 'Commands' }),
          selectHint: tChatInput('selectHint'),
          noMatchingCommand: tChatInput('noMatchingCommand', { defaultValue: 'No matching command' }),
          loadingMcpPrompts: tChatInput('loadingMcpPrompts', { defaultValue: 'Loading MCP prompts...' }),
          current: tChatInput('current'),
        }}
        onChange={handleInputChange}
        onLargePaste={createTextFragment}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleImeCompositionStart}
        onCompositionEnd={handleImeCompositionEnd}
        onRemoveAttachment={removeAttachment}
        onRemoveReference={removeReference}
        onCreateReference={createAttachmentReference}
        onUpdateContext={updateDraftContext}
        onMentionStateChange={setMentionState}
        onResolveAttachmentReference={resolveAttachmentReference}
        onCloseMention={() => {
          richTextInputRef.current?.closeMention();
          setMentionState({ isActive: false, query: '', startOffset: 0 });
        }}
        onSelectCommandOption={selectCommandOption}
        onHoverCommandIndex={(index) => setCommandState(prev => ({ ...prev, selectedIndex: index }))}
      />
    </div>
  );

  const actions = (
    <ComposerActions
      left={(
        <>
          {composerActionModel.actionButtonVisible && composerActionModel.menuSections.length > 0 ? (
            <ComposerActionMenu
              hostRef={agentBoostRef}
              skillsHostRef={skillsHostRef}
              sections={composerActionModel.menuSections}
              dropdownOpen={modeState.dropdownOpen}
              skillsFlyoutOpen={skillsFlyoutOpen}
              skillsFlyoutLeft={skillsFlyoutLeft}
              skillsFlyoutUp={skillsFlyoutUp}
              skillsTooltipSuppressed={skillsTooltipSuppressed}
              skillUnits={boostSkillUnits}
              selectedSkillCommands={selectedSkillCommands}
              boostSkillsLoading={boostSkillsLoading}
              selectedAgentLabel={selectedAgentLabel}
              labels={{
                addBoostTooltip: tChatInput('addBoostTooltip'),
                current: tChatInput('current'),
                resetAgent: tChatInput('resetToAgentic'),
                switchAgent: tChatInput('switchAgent', { defaultValue: 'Switch Agent' }),
                boostSkillsLoading: tChatInput('boostSkillsLoading'),
                boostSkillsEmpty: tChatInput('boostSkillsEmpty'),
                boostSkillsNoMatch: tChatInput('boostSkillsNoMatch'),
                boostSkillsSearch: tChatInput('boostSkillsSearch'),
                boostSkillsSuites: tChatInput('boostSkillsSuites'),
                boostSkillsStandalone: tChatInput('boostSkillsStandalone'),
                expandSuite: tChatInput('expandSkillSuite'),
                collapseSuite: tChatInput('collapseSkillSuite'),
                selected: tChatInput('skillSelected'),
                openSkillsLibrary: tChatInput('openSkillsLibrary'),
              }}
              onToggleDropdown={e => {
                e.stopPropagation();
                dispatchMode({ type: 'TOGGLE_DROPDOWN' });
              }}
              onResetAgent={handleResetAgentFromChip}
              onSelectAction={handleComposerActionSelect}
              onOpenSkillsFlyout={openSkillsFlyout}
              onCloseSkillsFlyout={closeSkillsFlyout}
              onSkillsListScroll={handleSkillsListScroll}
              onInsertSkill={(target, e) => {
                e.stopPropagation();
                insertSkillIntoInput(target);
              }}
              onOpenSkillsLibrary={handleOpenSkillsLibrary}
            />
          ) : null}
        </>
      )}
      sendAction={(
        <>
          {profile.composer?.showModelSelector !== false ? (
            <ModelSelector
              currentAgent={modeState.current}
              sessionId={effectiveTargetSessionId || undefined}
            />
          ) : null}

          {profile.composer?.showVoiceInput !== false ? (
            <ComposerVoiceInputButton controller={voiceInputController} />
          ) : null}

          {voiceInputController.phase === 'idle' ? (
            <ComposerSendAction
              derivedState={derivedState ?? null}
              hasSendablePayload={composerHasSendablePayload}
              labels={{
                sendShortcut: t('input.sendShortcut'),
                queueShortcut: t('input.queueShortcut'),
                stopGeneration: t('input.stopGeneration'),
                retry: t('input.retry'),
              }}
              onCancel={() => {
                void handleCancelGeneration();
              }}
              onSendOrCancel={() => {
                void handleSendOrCancel();
              }}
            />
          ) : null}
        </>
      )}
      isCollapsedProcessing={isCollapsedProcessing}
      isExpanded={inputState.isExpanded}
      labels={{
        cancelShortcut: t('input.cancelShortcut'),
        collapseInput: t('input.collapseInput'),
        expandInput: t('input.expandInput'),
      }}
      onToggleExpand={toggleExpand}
    />
  );

  return (
    <ComposerShell
      containerRef={containerRef}
      className={className}
      isActive={inputState.isActive}
      isExpanded={inputState.isExpanded}
      isAwakening={isAwakening}
      isStacked={useStackedComposerLayout}
      isTargeting={showTargetSwitcher}
      isProcessing={!!derivedState?.isProcessing}
      showCollapsedActionButton={composerActionModel.actionButtonVisible}
      recommendationContext={recommendationContext}
      sessionActivity={
        hasQueueActivity || composerHandoffState ? (
          <>
            <ComposerQueueTray sessionId={effectiveTargetSessionId} />
            {composerHandoffState ? <ComposerHandoffStatus state={composerHandoffState} /> : null}
          </>
        ) : null
      }
      targetSwitcher={null}
      editorArea={editorArea}
      actions={actions}
      workspaceMeta={profile.composer?.showWorkspaceMeta === false ? undefined : workspaceMeta}
      onOpenWorkspaceFiles={handleOpenWorkspaceFiles}
      contextUsageMeta={
        profile.composer?.showContextUsage === false ? undefined : contextUsageMeta
      }
      contextUsagePercent={contextUsagePercent}
      contextBudgetSnapshot={
        profile.composer?.showContextUsage === false ? undefined : tokenUsage.snapshot
      }
      allowContextInput={profile.composer?.allowContextInput !== false}
      onActivate={handleActivate}
      onContextAdded={handleDropContextAdded}
    />
  );
};

export default ChatInput;
