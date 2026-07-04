/**
 * Standalone chat input component
 * Separated from bottom bar, supports session-level state awareness
 */

import React, { useRef, useCallback, useEffect, useReducer, useState, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useContextStore } from '../../shared/context-system';
import type { MentionState, RichTextInputHandle } from './RichTextInput';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { shortcutManager } from '@/infrastructure/services/ShortcutManager';
import {
  useSessionDerivedState,
  useSessionStateMachineActions,
} from '../hooks/useSessionStateMachine';
import { ModelSelector } from './ModelSelector';
import type { ImageContext } from '../../shared/types/context';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { inputReducer, initialInputState } from '../reducers/inputReducer';
import { agentReducer, initialAgentState } from '../reducers/agentReducer';
import { useMessageSender } from '../hooks/useMessageSender';
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
import { ComposerSendAction } from './composer/ComposerSendAction';
import { ComposerShell } from './composer/ComposerShell';
import { useComposerLargePaste } from './composer/hooks/useComposerLargePaste';
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
  onSendMessage,
  onDispatchComposerAppAction,
}) => {
  const { t } = useTranslation('flow-chat');

  const [inputState, dispatchInput] = useReducer(inputReducer, initialInputState);
  const [modeState, dispatchMode] = useReducer(agentReducer, initialAgentState);

  const richTextInputRef = useRef<RichTextInputHandle>(null);
  const agentBoostRef = useRef<HTMLDivElement>(null);
  const isImeComposingRef = useRef(false);
  // Ref so the queuedInput sync effect can read the latest value without it being a dep
  const inputValueRef = useRef('');

  // History navigation state
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
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

  const contexts = useContextStore(state => state.contexts);
  const addContext = useContextStore(state => state.addContext);
  const removeContext = useContextStore(state => state.removeContext);
  const clearContexts = useContextStore(state => state.clearContexts);

  const imageContexts = useMemo(
    () => contexts.filter((c): c is ImageContext => c.type === 'image'),
    [contexts],
  );
  const currentImageCount = imageContexts.length;
  const { isInputMultiline } = useComposerLayout({
    editorRef: richTextInputRef,
    value: inputState.value,
    imageCount: currentImageCount,
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
  const derivedState = useSessionDerivedState(
    effectiveTargetSessionId,
    inputState.value.trim()
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
    storageScope: effectiveTargetSession?.storageScope ?? effectiveTargetSession?.descriptor.storageScope,
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
    boostPanelSkills,
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
  });

  useComposerHeightObserver(containerRef);
  useComposerInputLifecycle({
    effectiveTargetSessionId,
    isActive: inputState.isActive,
    isExpanded: inputState.isExpanded,
    setHistoryIndex,
  });

  const { sendMessage } = useMessageSender({
    currentSessionId: effectiveTargetSessionId || undefined,
    contexts,
    onClearContexts: clearContexts,
    onSuccess: onSendMessage,
    // Composer agent is authoritative, synced from the session descriptor.
    currentAgentType: modeState.current,
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
    storageScope: effectiveTargetSession?.storageScope ?? activeSessionDescriptor?.storageScope,
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
    effectiveTargetSession?.storageScope,
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

  const {
    clearPendingLargePastes,
    createLargePastePlaceholder,
    expandPendingLargePastes,
    getCharacterCount,
    prunePendingLargePastes,
    restorePendingLargePastes,
    snapshotPendingLargePastes,
  } = useComposerLargePaste(inputState.value, t);

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
    currentImageCount,
    currentSessionId,
    dispatchInput,
    inputIsActive: inputState.isActive,
    inputValueRef,
    isBtwSession,
    richTextInputRef,
    setHistoryIndex,
    setSavedDraft,
    t,
  });

  useComposerAgentSync({
    activeSessionDescriptor,
    dispatchMode,
    effectiveTargetSessionId,
  });

  useComposerQueuedInputRestore({
    clearPendingLargePastes,
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
    contexts,
    derivedState: derivedState ?? null,
    dispatchInput,
    inputIsActive: inputState.isActive,
    inputValueRef,
    isImeComposingRef,
    prunePendingLargePastes,
    removeContext,
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
    addContext,
    currentImageCount,
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
    currentImageCount,
    clearPendingLargePastes,
    activateInput: activateComposerInput,
    setInputValue: setComposerInputValue,
    setInputTarget: setComposerTarget,
    addContext,
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
    { priority: 10, description: 'keyboard.shortcuts.chat.activateInput' },
  );

  useEffect(() => {
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
  }, [activateComposerInput, focusRichTextInputSoon, playAwakeningMotion]);

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
    clearPendingLargePastes,
    expandPendingLargePastes,
    getCharacterCount,
    snapshotPendingLargePastes,
    restorePendingLargePastes,
    activeGoalId: activeGoalSnapshot.goal?.goalId,
    onBtwStarted: () => intentActions.setTarget('btw-thread'),
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
    inputValue: inputState.value,
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
    focusInputSoon: focusRichTextInputSoon,
    handleImageInput,
    inputValue: inputState.value,
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
      return t(`chatInput.agentNames.${agent}`, { defaultValue: '' }) ||
        modeState.available.find(item => item.id === agent)?.name ||
        agent;
    }
    return t(`chatInput.agentNames.${agent.id}`, { defaultValue: '' }) || agent.name;
  }, [modeState.available, t]);
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
          remove: t('chatInput.intentChips.remove', { defaultValue: 'Remove' }),
          targetMain: t('chatInput.targetMain', { defaultValue: 'Main' }),
          targetBtwDraft: t('chatInput.intentChips.targetBtwDraft', { defaultValue: 'Side question' }),
          targetBtwThread: t('chatInput.intentChips.targetBtwThread', { defaultValue: 'Side session' }),
          goalDraft: t('chatInput.intentChips.goalDraft', { defaultValue: 'Goal mode' }),
          goalActive: t('chatInput.intentChips.goalActive', { defaultValue: 'Goal active' }),
          goalPaused: t('chatInput.intentChips.goalPaused', { defaultValue: 'Goal paused' }),
          goalPending: t('chatInput.intentChips.goalPending', { defaultValue: 'Goal pending' }),
          operationCompact: t('chatInput.compactAction', { defaultValue: 'Compact session' }),
          operationInit: t('chatInput.initAction', { defaultValue: 'Generate AGENTS.md' }),
          promptTemplate: t('chatInput.intentChips.promptTemplate', { defaultValue: 'Prompt' }),
        }}
        onClearTarget={() => intentActions.setTarget('main')}
        onToggleTarget={handleToggleComposerTarget}
        onClearGoalModifier={() => intentActions.removeModifier('goal')}
        onClearOperation={intentActions.clearOperation}
        onClearPromptTemplate={intentActions.clearPromptTemplate}
      />
      <ComposerEditorArea
        editorRef={richTextInputRef}
        value={inputState.value}
        contexts={contexts}
        imageContexts={imageContexts}
        mentionState={mentionState}
        workspacePath={effectiveWorkspacePath ?? undefined}
        commandState={commandState}
        commandOptions={commandOptions}
        mcpPromptCommandsLoading={mcpPromptCommandsLoading}
        labels={{
          placeholder: t('input.placeholder'),
          spaceToActivate: (
            <Trans
              t={t}
              i18nKey="input.spaceToActivate"
              components={{
                space: <span className="sparo-chat-input__space-key" />,
              }}
            />
          ),
          removeImage: t('input.removeImage', { defaultValue: 'Remove image' }),
          commands: t('chatInput.composerCommands.title', { defaultValue: 'Commands' }),
          selectHint: t('chatInput.selectHint'),
          noMatchingCommand: t('chatInput.noMatchingCommand', { defaultValue: 'No matching command' }),
          loadingMcpPrompts: t('chatInput.loadingMcpPrompts', { defaultValue: 'Loading MCP prompts...' }),
          current: t('chatInput.current'),
        }}
        onChange={handleInputChange}
        onLargePaste={createLargePastePlaceholder}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleImeCompositionStart}
        onCompositionEnd={handleImeCompositionEnd}
        onRemoveContext={removeContext}
        onMentionStateChange={setMentionState}
        onAddContext={addContext}
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
              boostPanelSkills={boostPanelSkills}
              boostSkillsLoading={boostSkillsLoading}
              selectedAgentLabel={selectedAgentLabel}
              labels={{
                addBoostTooltip: t('chatInput.addBoostTooltip'),
                current: t('chatInput.current'),
                resetAgent: t('chatInput.resetToAgentic'),
                switchAgent: t('chatInput.switchAgent', { defaultValue: 'Switch Agent' }),
                boostSkillsLoading: t('chatInput.boostSkillsLoading'),
                boostSkillsEmpty: t('chatInput.boostSkillsEmpty'),
                openSkillsLibrary: t('chatInput.openSkillsLibrary'),
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
              onInsertSkill={(skillName, e) => {
                e.stopPropagation();
                insertSkillIntoInput(skillName);
              }}
              onOpenSkillsLibrary={handleOpenSkillsLibrary}
            />
          ) : null}
        </>
      )}
      sendAction={(
        <>
          <ModelSelector
            currentAgent={modeState.current}
            sessionId={effectiveTargetSessionId || undefined}
          />

          <ComposerSendAction
            derivedState={derivedState ?? null}
            draftValue={inputState.value}
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
      workspaceMeta={workspaceMeta}
      onOpenWorkspaceFiles={handleOpenWorkspaceFiles}
      contextUsageMeta={contextUsageMeta}
      contextUsagePercent={contextUsagePercent}
      contextBudgetSnapshot={tokenUsage.snapshot}
      onActivate={handleActivate}
      onContextAdded={handleDropContextAdded}
    />
  );
};

export default ChatInput;
