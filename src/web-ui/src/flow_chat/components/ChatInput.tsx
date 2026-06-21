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
import { ComposerActions } from './composer/ComposerActions';
import { ComposerBoostMenu } from './composer/ComposerBoostMenu';
import { ComposerEditorArea } from './composer/ComposerEditorArea';
import { ComposerIntentChips } from './composer/ComposerIntentChips';
import { ComposerSendAction } from './composer/ComposerSendAction';
import { ComposerShell } from './composer/ComposerShell';
import { ComposerTargetSwitcher } from './composer/ComposerTargetSwitcher';
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
  NO_COMPOSER_INPUT_DETECTION,
  type ComposerInputDetection,
} from './composer/model/composerInputDetection';
import {
  composerSessionTargetFromIntent,
} from './composer/model/composerIntentState';
import type { ComposerCommandContext } from './composer/model/composerCommandRegistry';
import { deriveComposerOsHandoffState } from '../domain/osHandoffIntent';
import { supportsSessionGoal } from '../domain/goalSupport';
import { useSessionGoalSnapshot } from '../store/sessionGoalStore';
import './ChatInput.scss';

export interface ChatInputProps {
  className?: string;
  targetSessionId?: string | null;
  onSendMessage?: (message: string) => void;
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
  onSendMessage
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

  const { profile } = useSessionProfile();
  const {
    activeBtwSessionTitle,
    activeSessionDescriptor,
    currentSessionId,
    currentSessionModelId,
    currentSessionTitle,
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
  const workspaceMeta = useMemo(() => {
    if (profile.workspaceScope.kind === 'global') {
      return t('input.globalWorkspace', { defaultValue: 'Global' });
    }

    return (
      effectiveTargetSession?.workspacePath?.trim() ||
      workspacePath ||
      t('input.globalWorkspace', { defaultValue: 'Global' })
    );
  }, [
    effectiveTargetSession?.workspacePath,
    profile.workspaceScope.kind,
    t,
    workspacePath,
  ]);
  const contextUsageMeta = tokenUsage.snapshot
    ? `${contextUsagePercentText}%`
    : tokenUsage.current > 0
      ? `${contextUsagePercentText}%`
      : t('input.contextUsageLoading', { defaultValue: 'Context' });
  const currentAgent = modeState.current;
  const agentPolicy = activeSessionDescriptor?.agentPolicy;
  const canSwitchAgents =
    profile.capabilities.canSwitchAgents &&
    (agentPolicy?.switchableAgentIds.length ?? 0) > 1;
  const workspaceFilesTargetPath = profile.workspaceScope.kind === 'global'
    ? null
    : (effectiveTargetSession?.workspacePath?.trim() || workspacePath || null);
  const commandContext = useMemo<ComposerCommandContext>(() => ({
    canSwitchAgents,
    currentAgent,
    hasCurrentSession: Boolean(currentSessionId),
    hasTargetSession: Boolean(effectiveTargetSessionId),
    isBtwSession,
    isProcessing: Boolean(derivedState?.isProcessing),
    supportsGoal: supportsSessionGoal({
      workspacePath: effectiveTargetSession?.workspacePath?.trim() || workspacePath || null,
      workspaceScopeKind: profile.workspaceScope.kind,
      storageScope: effectiveTargetSession?.storageScope ?? effectiveTargetSession?.descriptor.storageScope,
      descriptor: effectiveTargetSession?.descriptor,
      agentId: currentAgent,
    }),
  }), [
    canSwitchAgents,
    currentAgent,
    currentSessionId,
    derivedState?.isProcessing,
    effectiveTargetSessionId,
    effectiveTargetSession?.descriptor,
    effectiveTargetSession?.storageScope,
    effectiveTargetSession?.workspacePath,
    isBtwSession,
    profile.workspaceScope.kind,
    workspacePath,
  ]);
  const handleOpenWorkspaceFiles = useCallback(() => {
    openWorkspaceScene('file-viewer', { workspacePath: workspaceFilesTargetPath });
  }, [workspaceFilesTargetPath]);

  // Session-level mode policy: fixed-purpose sessions are not available as incremental mode switches.
  const switchableAgents = useMemo(
    () =>
      modeState.available.filter(agent =>
        agent.enabled &&
        (agentPolicy?.switchableAgentIds.includes(agent.id) ?? false)
      ),
    [agentPolicy?.switchableAgentIds, modeState.available]
  );

  /** Code session: agents switchable on top of default agentic */
  const incrementalCodeAgents = useMemo(
    () => switchableAgents.filter(m => m.id === 'Plan' || m.id === 'debug' || m.id === 'Team'),
    [switchableAgents]
  );

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
    workspacePath,
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
  const recommendationContext = useComposerRecommendations({
    effectiveTargetSessionId,
    isProcessing: !!derivedState?.isProcessing,
    workspacePath,
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
  const activeGoalSnapshot = useSessionGoalSnapshot(effectiveTargetSessionId);
  const hasActiveGoalChip = (
    activeGoalSnapshot.phase === 'extracting' ||
    activeGoalSnapshot.phase === 'judging' ||
    activeGoalSnapshot.phase === 'active' ||
    activeGoalSnapshot.phase === 'waiting_user' ||
    activeGoalSnapshot.phase === 'paused' ||
    activeGoalSnapshot.phase === 'blocked' ||
    activeGoalSnapshot.phase === 'budget_limited' ||
    activeGoalSnapshot.phase === 'failed' ||
    activeGoalSnapshot.phase === 'needs_clarification'
  );
  const hasComposerIntentChips =
    composerIntent.target !== 'main' ||
    composerIntent.modifiers.length > 0 ||
    composerIntent.operation !== null ||
    composerIntent.promptTemplate !== null ||
    hasActiveGoalChip ||
    (canSwitchAgents && modeState.current !== 'agentic');
  const useStackedComposerLayout = isInputMultiline || showTargetSwitcher || hasComposerIntentChips;

  const {
    commandOptions,
    resolveCommandOption,
  } = useComposerCommandOptions({
    t,
    commandContext,
    commandState,
    inputDetection,
    incrementalAgents: incrementalCodeAgents,
    loadMcpPromptCommands,
    mcpPromptCommands,
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
    currentAgent,
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

  useComposerOutsideInteractions({
    agentBoostRef,
    containerRef,
    dispatchMode,
    dropdownOpen: modeState.dropdownOpen,
    slashCommandOpen: commandState.isOpen,
    setSkillsFlyoutOpen,
    setCommandState,
  });

  const isCollapsedProcessing = !inputState.isActive && !!derivedState?.isProcessing;
  const composerHandoffState = deriveComposerOsHandoffState(effectiveTargetSession);

  const targetSwitcher = showTargetSwitcher ? (
    <ComposerTargetSwitcher
      label={t('chatInput.conversationTarget')}
      mainLabel={t('chatInput.targetMain')}
      btwLabel={t('chatInput.targetBtw')}
      currentSessionTitle={currentSessionTitle}
      activeBtwSessionTitle={activeBtwSessionTitle}
      value={inputTarget}
      onChange={setComposerTarget}
    />
  ) : null;

  const getAgentDisplayName = useCallback((agent: { id: string; name: string } | string) => {
    if (typeof agent === 'string') {
      return t(`chatInput.agentNames.${agent}`, { defaultValue: '' }) ||
        modeState.available.find(item => item.id === agent)?.name ||
        agent;
    }
    return t(`chatInput.agentNames.${agent.id}`, { defaultValue: '' }) || agent.name;
  }, [modeState.available, t]);

  const handleResetAgentFromChip = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    applyAgentChange('agentic');
    dispatchMode({ type: 'CLOSE_DROPDOWN' });
  }, [applyAgentChange, dispatchMode]);

  const editorArea = (
    <>
      <ComposerIntentChips
        intent={composerIntent}
        activeGoalSnapshot={activeGoalSnapshot}
        currentAgent={modeState.current}
        canSwitchAgents={canSwitchAgents}
        getAgentName={(agentId) => getAgentDisplayName(agentId)}
        labels={{
          remove: t('chatInput.intentChips.remove', { defaultValue: 'Remove' }),
          resetAgent: t('chatInput.resetToAgentic'),
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
        onClearGoalModifier={() => intentActions.removeModifier('goal')}
        onClearOperation={intentActions.clearOperation}
        onClearPromptTemplate={intentActions.clearPromptTemplate}
        onResetAgent={handleResetAgentFromChip}
      />
      <ComposerEditorArea
        editorRef={richTextInputRef}
        value={inputState.value}
        contexts={contexts}
        imageContexts={imageContexts}
        mentionState={mentionState}
        workspacePath={workspacePath}
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
    </>
  );

  const actions = (
    <ComposerActions
      left={(
        <>
          <ComposerBoostMenu
            hostRef={agentBoostRef}
            skillsHostRef={skillsHostRef}
            canSwitchAgents={canSwitchAgents}
            currentAgent={modeState.current}
            incrementalAgents={incrementalCodeAgents}
            dropdownOpen={modeState.dropdownOpen}
            skillsFlyoutOpen={skillsFlyoutOpen}
            skillsFlyoutLeft={skillsFlyoutLeft}
            skillsFlyoutUp={skillsFlyoutUp}
            skillsTooltipSuppressed={skillsTooltipSuppressed}
            boostPanelSkills={boostPanelSkills}
            boostSkillsLoading={boostSkillsLoading}
            currentSessionId={currentSessionId || undefined}
            isBtwSession={isBtwSession}
            labels={{
              addBoostTooltip: t('chatInput.addBoostTooltip'),
              resetToAgentic: t('chatInput.resetToAgentic'),
              current: t('chatInput.current'),
              noIncrementalAgents: t('chatInput.noIncrementalAgents'),
              boostAddContext: t('chatInput.boostAddContext'),
              addImage: t('input.addImage'),
              boostSkills: t('chatInput.boostSkills'),
              boostSkillsLoading: t('chatInput.boostSkillsLoading'),
              boostSkillsEmpty: t('chatInput.boostSkillsEmpty'),
              openSkillsLibrary: t('chatInput.openSkillsLibrary'),
              boostStartBtw: t('chatInput.boostStartBtw'),
            }}
            getAgentName={agent =>
              getAgentDisplayName(agent)
            }
            getAgentDescription={agent =>
              t(`chatInput.agentDescriptions.${agent.id}`, { defaultValue: '' }) ||
              agent.description ||
              agent.name
            }
            onToggleDropdown={e => {
              e.stopPropagation();
              dispatchMode({ type: 'TOGGLE_DROPDOWN' });
            }}
            onRequestAgentChange={(agentId, e) => {
              e.stopPropagation();
              requestAgentChange(agentId);
            }}
            onOpenContext={handleBoostOpenAtContext}
            onPickImage={handleBoostPickImage}
            onOpenSkillsFlyout={openSkillsFlyout}
            onCloseSkillsFlyout={closeSkillsFlyout}
            onSkillsListScroll={handleSkillsListScroll}
            onInsertSkill={(skillName, e) => {
              e.stopPropagation();
              insertSkillIntoInput(skillName);
            }}
            onOpenSkillsLibrary={handleOpenSkillsLibrary}
            onStartBtw={handleBoostStartBtw}
          />
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
      recommendationContext={recommendationContext}
      sessionActivity={
        hasQueueActivity || composerHandoffState ? (
          <>
            <ComposerQueueTray sessionId={effectiveTargetSessionId} />
            {composerHandoffState ? <ComposerHandoffStatus state={composerHandoffState} /> : null}
          </>
        ) : null
      }
      targetSwitcher={targetSwitcher}
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
