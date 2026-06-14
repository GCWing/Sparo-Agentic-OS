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
import { SessionExecutionEvent } from '../state-machine/types';
import { ModelSelector } from './ModelSelector';
import type { ImageContext } from '../../shared/types/context';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { inputReducer, initialInputState } from '../reducers/inputReducer';
import { agentReducer, initialAgentState } from '../reducers/agentReducer';
import { useMessageSender } from '../hooks/useMessageSender';
import { useInputHistoryStore } from '../store/inputHistoryStore';
import { useSessionProfile } from '@/app/session-profiles';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { ComposerActions } from './composer/ComposerActions';
import { ComposerBoostMenu } from './composer/ComposerBoostMenu';
import { ComposerEditorArea } from './composer/ComposerEditorArea';
import { ComposerSendAction } from './composer/ComposerSendAction';
import { ComposerShell } from './composer/ComposerShell';
import { ComposerTargetSwitcher } from './composer/ComposerTargetSwitcher';
import { useComposerLargePaste } from './composer/hooks/useComposerLargePaste';
import { useComposerLayout } from './composer/hooks/useComposerLayout';
import { useComposerBoostActions } from './composer/hooks/useComposerBoostActions';
import { useComposerBoostSkills } from './composer/hooks/useComposerBoostSkills';
import { useComposerCommandCatalog } from './composer/hooks/useComposerCommandCatalog';
import { useComposerCommandPreload } from './composer/hooks/useComposerCommandPreload';
import { useComposerExternalEvents } from './composer/hooks/useComposerExternalEvents';
import { useComposerHeightObserver } from './composer/hooks/useComposerHeightObserver';
import { useComposerInputActions } from './composer/hooks/useComposerInputActions';
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
import { useComposerSubmitActions } from './composer/hooks/useComposerSubmitActions';
import { useComposerTextInput } from './composer/hooks/useComposerTextInput';
import { useComposerTokenUsage } from './composer/hooks/useComposerTokenUsage';
import { ComposerHandoffStatus } from './composer/ComposerHandoffStatus';
import type { ChatInputTarget, ComposerSlashCommandState } from './composer/model/composerState';
import { deriveComposerOsHandoffState } from '../domain/osHandoffIntent';
import './ChatInput.scss';

export interface ChatInputProps {
  className?: string;
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
  const [inputTarget, setInputTarget] = useState<ChatInputTarget>('main');
  const [isAwakening, setIsAwakening] = useState(false);
  const { addMessage: addToHistory, getSessionHistory } = useInputHistoryStore();
  const containerRef = useRef<HTMLDivElement>(null);

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
    currentSession,
    currentSessionId,
    currentSessionModelId,
    currentSessionTitle,
    effectiveTargetSession,
    effectiveTargetSessionId,
    isBtwSession,
    showTargetSwitcher,
  } = useComposerSessionTarget({
    inputTarget,
    setInputTarget,
    t,
  });
  const useStackedComposerLayout = isInputMultiline || showTargetSwitcher;
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

  const [slashCommandState, setSlashCommandState] = useState<ComposerSlashCommandState>({
    isActive: false,
    kind: 'agents',
    query: '',
    selectedIndex: 0,
  });

  const {
    getFilteredActions,
    getFilteredIncrementalAgents,
    getSlashPickerItems,
    resolveTypedMcpPromptCommand,
  } = useComposerCommandCatalog({
    t,
    isBtwSession,
    canSwitchAgents,
    incrementalCodeAgents,
    mcpPromptCommands,
    query: slashCommandState.query,
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

  useComposerCommandPreload({
    isProcessing: !!derivedState?.isProcessing,
    loadMcpPromptCommands,
    slashKind: slashCommandState.kind,
    slashPickerOpen: slashCommandState.isActive,
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

  const handleInputChange = useComposerTextInput({
    contexts,
    derivedState: derivedState ?? null,
    dispatchInput,
    inputIsActive: inputState.isActive,
    inputValueRef,
    prunePendingLargePastes,
    removeContext,
    resolveTypedMcpPromptCommand,
    setQueuedInput,
    setSlashCommandState,
    slashCommandState,
  });

  const {
    applyAgentChange,
    requestAgentChange,
    selectSlashCommandAction,
    selectSlashCommandAgent,
    selectSlashPromptCommand,
  } = useComposerAgentActions({
    canSwitchAgents,
    currentAgent,
    dispatchInput,
    dispatchMode,
    effectiveTargetSessionId,
    inputValue: inputState.value,
    isBtwSession,
    richTextInputRef,
    setQueuedInput,
    setSlashCommandState,
    switchableAgents,
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
    setInputTarget,
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
    handleSendOrCancel,
    submitBtwFromInput,
  } = useComposerSubmitActions({
    t,
    inputValue: inputState.value,
    setInputValue: setComposerInputValue,
    activateInput: activateComposerInput,
    clearInput: clearComposerInput,
    setQueuedInput,
    setSlashCommandState,
    currentSessionId,
    currentSession,
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
    loadMcpPromptCommands,
    resolveTypedMcpPromptCommand,
    onBtwStarted: () => setInputTarget('btw'),
  });

  const handleKeyDown = useComposerKeyboard({
    editorRef: richTextInputRef,
    isImeComposingRef,
    slashCommandState,
    setSlashCommandState,
    canSwitchAgents,
    getFilteredIncrementalAgents,
    getFilteredActions,
    getSlashPickerItems,
    selectSlashCommandAgent,
    selectSlashCommandAction,
    selectSlashPromptCommand,
    showTargetSwitcher,
    setInputTarget,
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
    submitBtwFromInput: () => {
      void submitBtwFromInput();
    },
    handleSendOrCancel: () => {
      void handleSendOrCancel();
    },
    derivedState: derivedState ?? null,
    cancelGeneration: () => {
      void transition(SessionExecutionEvent.USER_CANCEL);
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
    richTextInputRef,
    selectSlashCommandAction,
    t,
  });

  useComposerOutsideInteractions({
    agentBoostRef,
    containerRef,
    dispatchMode,
    dropdownOpen: modeState.dropdownOpen,
    slashCommandOpen: slashCommandState.isActive,
    setSkillsFlyoutOpen,
    setSlashCommandState,
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
      onChange={setInputTarget}
    />
  ) : null;

  const editorArea = (
    <ComposerEditorArea
      editorRef={richTextInputRef}
      value={inputState.value}
      contexts={contexts}
      imageContexts={imageContexts}
      mentionState={mentionState}
      workspacePath={workspacePath}
      slashCommandState={slashCommandState}
      canSwitchAgents={canSwitchAgents}
      currentAgent={modeState.current}
      mcpPromptCommandsLoading={mcpPromptCommandsLoading}
      actions={getFilteredActions()}
      allItems={getSlashPickerItems()}
      filteredAgents={getFilteredIncrementalAgents()}
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
        quickAction: t('chatInput.quickAction', { defaultValue: 'Quick action' }),
        commands: t('chatInput.quickAction', { defaultValue: 'Commands' }),
        addAgentMenuTitle: t('chatInput.addAgentMenuTitle'),
        selectHint: t('chatInput.selectHint'),
        noMatchingCommand: t('chatInput.noMatchingCommand', { defaultValue: 'No matching command' }),
        noMatchingAgent: t('chatInput.noMatchingAgent'),
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
      onSelectAction={selectSlashCommandAction}
      onSelectAgent={selectSlashCommandAgent}
      onSelectPrompt={selectSlashPromptCommand}
      onHoverCommandIndex={(index) => setSlashCommandState(prev => ({ ...prev, selectedIndex: index }))}
    />
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
            availableAgents={modeState.available}
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
              typeof agent === 'string'
                ? t(`chatInput.agentNames.${agent}`, { defaultValue: '' })
                : t(`chatInput.agentNames.${agent.id}`, { defaultValue: '' }) || agent.name
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
            onCloseDropdown={() => dispatchMode({ type: 'CLOSE_DROPDOWN' })}
            onResetAgent={e => {
              e.stopPropagation();
              applyAgentChange('agentic');
              dispatchMode({ type: 'CLOSE_DROPDOWN' });
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
              stopGeneration: t('input.stopGeneration'),
              retry: t('input.retry'),
            }}
            onCancel={() => {
              void transition(SessionExecutionEvent.USER_CANCEL);
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
      sessionActivity={composerHandoffState ? <ComposerHandoffStatus state={composerHandoffState} /> : null}
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
