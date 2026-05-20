/**
 * Standalone chat input component
 * Separated from bottom bar, supports session-level state awareness
 */

import React, { useRef, useCallback, useReducer, useState, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useContextStore } from '../../shared/context-system';
import type { MentionState, RichTextInputHandle } from './RichTextInput';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import {
  useSessionDerivedState,
  useSessionStateMachineActions,
} from '../hooks/useSessionStateMachine';
import { SessionExecutionEvent } from '../state-machine/types';
import { ModelSelector } from './ModelSelector';
import type { ImageContext } from '../../shared/types/context';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { inputReducer, initialInputState } from '../reducers/inputReducer';
import { modeReducer, initialModeState } from '../reducers/modeReducer';
import { useMessageSender } from '../hooks/useMessageSender';
import { useInputHistoryStore } from '../store/inputHistoryStore';
import { useSessionProfile } from '@/app/session-profiles';
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
import { useComposerFlowChatState } from './composer/hooks/useComposerFlowChatState';
import { useComposerHeightObserver } from './composer/hooks/useComposerHeightObserver';
import { useComposerInputActions } from './composer/hooks/useComposerInputActions';
import { useComposerInputLifecycle } from './composer/hooks/useComposerInputLifecycle';
import { useComposerKeyboard } from './composer/hooks/useComposerKeyboard';
import { useComposerMediaInput } from './composer/hooks/useComposerMediaInput';
import { useComposerMcpPromptCommands } from './composer/hooks/useComposerMcpPromptCommands';
import { useComposerModeActions } from './composer/hooks/useComposerModeActions';
import { useComposerModeSync } from './composer/hooks/useComposerModeSync';
import { useComposerOutsideInteractions } from './composer/hooks/useComposerOutsideInteractions';
import { useComposerQueuedInputRestore } from './composer/hooks/useComposerQueuedInputRestore';
import { useComposerRecommendations } from './composer/hooks/useComposerRecommendations';
import { useComposerSessionTarget } from './composer/hooks/useComposerSessionTarget';
import { useComposerSubmitActions } from './composer/hooks/useComposerSubmitActions';
import { useComposerTextInput } from './composer/hooks/useComposerTextInput';
import { useComposerTokenUsage } from './composer/hooks/useComposerTokenUsage';
import type { ChatInputTarget, ComposerSlashCommandState } from './composer/model/composerState';
import './ChatInput.scss';

export interface ChatInputProps {
  className?: string;
  onSendMessage?: (message: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  className = '',
  onSendMessage
}) => {
  const { t } = useTranslation('flow-chat');
  
  const [inputState, dispatchInput] = useReducer(inputReducer, initialInputState);
  const [modeState, dispatchMode] = useReducer(modeReducer, initialModeState);
  
  const richTextInputRef = useRef<RichTextInputHandle>(null);
  const agentBoostRef = useRef<HTMLDivElement>(null);
  const isImeComposingRef = useRef(false);
  // Ref so the queuedInput sync effect can read the latest value without it being a dep
  const inputValueRef = useRef('');
  
  // History navigation state
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const [inputTarget, setInputTarget] = useState<ChatInputTarget>('main');
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
  const flowChatState = useComposerFlowChatState();
  const {
    activeBtwSessionTitle,
    activeSessionMode,
    currentSession,
    currentSessionId,
    currentSessionModelId,
    currentSessionTitle,
    effectiveTargetSession,
    effectiveTargetSessionId,
    isBtwSession,
    showTargetSwitcher,
  } = useComposerSessionTarget({
    flowChatState,
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
  const currentMode = modeState.current;
  const canSwitchModes = profile.capabilities.canSwitchModes;

  // Session-level mode policy: fixed-purpose sessions are not available as incremental mode switches.
  const switchableModes = useMemo(
    () =>
      modeState.available.filter(mode =>
        mode.enabled &&
        mode.id !== 'Cowork' &&
        mode.id !== 'Design'
      ),
    [modeState.available]
  );

  /** Code session: modes switchable on top of default agentic */
  const incrementalCodeModes = useMemo(
    () => switchableModes.filter(m => m.id === 'Plan' || m.id === 'debug' || m.id === 'Team'),
    [switchableModes]
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
    // Composer mode is authoritative (synced from session on switch, updated in
    // applyModeChange). Prefer it over session.mode so a stale store cannot force
    // agentic when the user selected Team or another mode.
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
    kind: 'modes',
    query: '',
    selectedIndex: 0,
  });

  const {
    getFilteredActions,
    getFilteredIncrementalModes,
    getSlashPickerItems,
    resolveTypedMcpPromptCommand,
  } = useComposerCommandCatalog({
    t,
    isBtwSession,
    canSwitchModes,
    incrementalCodeModes,
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

  useComposerModeSync({
    activeSessionMode,
    currentMode,
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
    applyModeChange,
    requestModeChange,
    selectSlashCommandAction,
    selectSlashCommandMode,
    selectSlashPromptCommand,
  } = useComposerModeActions({
    canSwitchModes,
    currentMode,
    dispatchInput,
    dispatchMode,
    effectiveTargetSessionId,
    inputValue: inputState.value,
    isBtwSession,
    richTextInputRef,
    setQueuedInput,
    setSlashCommandState,
    switchableModes,
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
    addContext,
    t,
  });

  useShortcut(
    'chat.activateInput',
    { key: ' ', scope: 'chat' },
    () => {
      activateComposerInput();
      focusRichTextInputSoon();
    },
    { priority: 10, description: 'keyboard.shortcuts.chat.activateInput' },
  );

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
    canSwitchModes,
    getFilteredIncrementalModes,
    getFilteredActions,
    getSlashPickerItems,
    selectSlashCommandMode,
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
    setSkillsFlyoutOpen,
  });

  const isCollapsedProcessing = !inputState.isActive && !!derivedState?.isProcessing;

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
      canSwitchModes={canSwitchModes}
      currentMode={modeState.current}
      mcpPromptCommandsLoading={mcpPromptCommandsLoading}
      actions={getFilteredActions()}
      allItems={getSlashPickerItems()}
      filteredModes={getFilteredIncrementalModes()}
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
        addModeMenuTitle: t('chatInput.addModeMenuTitle'),
        selectHint: t('chatInput.selectHint'),
        noMatchingCommand: t('chatInput.noMatchingCommand', { defaultValue: 'No matching command' }),
        noMatchingMode: t('chatInput.noMatchingMode'),
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
      onSelectMode={selectSlashCommandMode}
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
            canSwitchModes={canSwitchModes}
            currentMode={modeState.current}
            availableModes={modeState.available}
            incrementalModes={incrementalCodeModes}
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
              noIncrementalModes: t('chatInput.noIncrementalModes'),
              boostAddContext: t('chatInput.boostAddContext'),
              addImage: t('input.addImage'),
              boostSkills: t('chatInput.boostSkills'),
              boostSkillsLoading: t('chatInput.boostSkillsLoading'),
              boostSkillsEmpty: t('chatInput.boostSkillsEmpty'),
              openSkillsLibrary: t('chatInput.openSkillsLibrary'),
              boostStartBtw: t('chatInput.boostStartBtw'),
            }}
            getModeName={mode =>
              typeof mode === 'string'
                ? t(`chatInput.modeNames.${mode}`, { defaultValue: '' })
                : t(`chatInput.modeNames.${mode.id}`, { defaultValue: '' }) || mode.name
            }
            getModeDescription={mode =>
              t(`chatInput.modeDescriptions.${mode.id}`, { defaultValue: '' }) ||
              mode.description ||
              mode.name
            }
            onToggleDropdown={e => {
              e.stopPropagation();
              dispatchMode({ type: 'TOGGLE_DROPDOWN' });
            }}
            onCloseDropdown={() => dispatchMode({ type: 'CLOSE_DROPDOWN' })}
            onResetMode={e => {
              e.stopPropagation();
              applyModeChange('agentic');
              dispatchMode({ type: 'CLOSE_DROPDOWN' });
            }}
            onRequestModeChange={(modeId, e) => {
              e.stopPropagation();
              requestModeChange(modeId);
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

          <ModelSelector
            currentMode={modeState.current}
            sessionId={effectiveTargetSessionId || undefined}
            currentTokens={tokenUsage.current}
            maxTokens={tokenUsage.max}
          />
        </>
      )}
      sendAction={(
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
      isStacked={useStackedComposerLayout}
      isTargeting={showTargetSwitcher}
      isProcessing={!!derivedState?.isProcessing}
      recommendationContext={recommendationContext}
      targetSwitcher={targetSwitcher}
      editorArea={editorArea}
      actions={actions}
      onActivate={handleActivate}
      onContextAdded={handleDropContextAdded}
    />
  );
};

export default ChatInput;
