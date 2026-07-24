import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { notificationService } from '@/shared/notification-system';
import MCPAPI from '@/infrastructure/api/service-api/MCPAPI';
import { CHAT_INPUT_CONFIG } from '../../../constants/chatInputConfig';
import { FlowChatManager } from '../../../services/FlowChatManager';
import { startBtwThread } from '../../../services/BtwThreadService';
import { openBtwSessionInAuxPane } from '../../../services/childSessionPanels';
import { SessionExecutionEvent, type SessionDerivedState } from '../../../state-machine/types';
import type { Session } from '../../../types/flow-chat';
import { supportsSessionGoal } from '../../../domain/goalSupport';
import { useSessionGoalStore } from '../../../store/sessionGoalStore';
import {
  parseSlashArguments,
  renderMcpPromptMessages,
} from '../model/composerCommands';
import {
  hasComposerGoalModifier,
  type ComposerIntentState,
  type ComposerTargetIntent,
} from '../model/composerIntentState';
import { createLogger } from '@/shared/utils/logger';
import type { ComposerDocument } from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import {
  createComposerContextSnapshot,
  freezeComposerDraftContextEditors,
  restoreComposerDraftContextEditors,
  serializeComposerDocumentForDisplay,
  serializeComposerDocumentForModel,
} from '../../../domain/composerContextRegistry';

const log = createLogger('ComposerSubmission');

type ComposerSendMessageOptions = {
  displayMessage?: string;
  metadata?: Record<string, any>;
  triggerSource?: import('@/shared/types/session-history').TriggerSource;
  systemReminderOverride?: string;
  localDialogTurnId?: string;
};

interface UseComposerSubmissionParams {
  t: TFunction<'flow-chat'>;
  intent: ComposerIntentState;
  inputValue: string;
  setInputValue: (value: string) => void;
  activateInput: () => void;
  clearInput: () => void;
  setQueuedInput: (value: string | null) => void;
  resetIntentAfterSubmit: (keepTarget?: ComposerTargetIntent) => void;
  currentSessionId?: string | null;
  currentSessionModelId: string;
  effectiveTargetSessionId?: string | null;
  effectiveTargetSession?: Session;
  workspacePath?: string;
  isBtwSession: boolean;
  derivedState: SessionDerivedState | null;
  transition: (event: SessionExecutionEvent) => Promise<unknown>;
  sendMessage: (message: string, options?: ComposerSendMessageOptions) => Promise<void>;
  addToHistory: (
    sessionId: string,
    message: string,
    composerContext: ReturnType<typeof createComposerContextSnapshot>,
  ) => void;
  resetHistoryDraft: () => void;
  onSendMessage?: (message: string) => void;
  document: ComposerDocument;
  contexts: ContextItem[];
  restoreDraft: (document: ComposerDocument, contexts: ContextItem[]) => void;
  restoreDraftIfEmpty: (document: ComposerDocument, contexts: ContextItem[]) => boolean;
  updateDraftContext: (contextId: string, updates: Partial<ContextItem>) => void;
  draftKey: string;
  activeGoalId?: string | null;
  onBtwStarted?: () => void;
}

function createGoalTurnId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `goal-turn-${cryptoApi.randomUUID()}`;
  }
  return `goal-turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function goalInitialSystemReminder(): string {
  return [
    'This turn was submitted through Goal mode.',
    'Execute the user request in this current session.',
    'The Goal lifecycle is tracked by the system; do not claim the goal is complete in a final answer unless you have submitted completion evidence through the Goal tool.',
  ].join('\n');
}

export function useComposerSubmission({
  t,
  intent,
  inputValue,
  setInputValue,
  activateInput,
  clearInput,
  setQueuedInput,
  resetIntentAfterSubmit,
  currentSessionId,
  currentSessionModelId,
  effectiveTargetSessionId,
  effectiveTargetSession,
  workspacePath,
  isBtwSession,
  derivedState,
  transition,
  sendMessage,
  addToHistory,
  resetHistoryDraft,
  onSendMessage,
  document,
  contexts,
  restoreDraft,
  restoreDraftIfEmpty,
  updateDraftContext,
  draftKey,
  activeGoalId,
  onBtwStarted,
}: UseComposerSubmissionParams) {
  const validateMessageSize = useCallback((message: string): boolean => {
    const messageCharCount = Array.from(message).length;
    if (messageCharCount <= CHAT_INPUT_CONFIG.largePaste.maxMessageChars) {
      return true;
    }

    notificationService.error(t('input.messageTooLarge', {
      max: CHAT_INPUT_CONFIG.largePaste.maxMessageChars,
      count: messageCharCount,
      defaultValue: 'Message exceeds the maximum length of {{max}} characters ({{count}} provided).',
    }), { duration: 4000 });
    return false;
  }, [t]);

  const modelMessage = serializeComposerDocumentForModel(document, contexts);
  const displayMessage = serializeComposerDocumentForDisplay(document, contexts, t);
  const composerContextSnapshot = createComposerContextSnapshot(document, contexts);

  const clearDraftForSubmit = useCallback(() => {
    freezeComposerDraftContextEditors(composerContextSnapshot, draftKey);
    resetHistoryDraft();
    clearInput();
    setQueuedInput(null);
  }, [clearInput, composerContextSnapshot, draftKey, resetHistoryDraft, setQueuedInput]);

  const restoreDraftAfterFailure = useCallback((
    originalDocument: ComposerDocument,
    originalContexts: ContextItem[],
  ) => {
    if (!restoreDraftIfEmpty(originalDocument, originalContexts)) return;
    const originalSnapshot = createComposerContextSnapshot(originalDocument, originalContexts);
    restoreComposerDraftContextEditors(originalSnapshot, draftKey, updateDraftContext);
    activateInput();
    setInputValue(originalDocument.nodes
      .filter(node => node.type === 'text')
      .map(node => node.text)
      .join(''));
    restoreDraft(originalDocument, originalContexts);
    if (derivedState?.isProcessing) {
      setQueuedInput(modelMessage);
    }
  }, [
    activateInput,
    derivedState?.isProcessing,
    modelMessage,
    restoreDraft,
    restoreDraftIfEmpty,
    draftKey,
    setInputValue,
    setQueuedInput,
    updateDraftContext,
  ]);

  const submitBtwDraft = useCallback(async () => {
    if (!currentSessionId) {
      notificationService.error(t('btw.noSession', { defaultValue: 'No active session for /btw' }));
      return;
    }
    if (isBtwSession) {
      notificationService.warning(t('btw.nestedDisabled', { defaultValue: 'Side questions cannot create another side question' }));
      return;
    }

    const originalDocument = structuredClone(document);
    const originalContexts = structuredClone(contexts);
    const question = modelMessage.trim();

    if (!question) {
      notificationService.warning(t('btw.empty', { defaultValue: 'Please provide a side question.' }));
      return;
    }
    if (!validateMessageSize(question)) {
      return;
    }

    clearDraftForSubmit();

    try {
      const { childSessionId } = await startBtwThread({
        parentSessionId: currentSessionId,
        workspacePath: workspacePath || '',
        question,
        modelId: currentSessionModelId,
      });
      openBtwSessionInAuxPane({
        childSessionId,
        parentSessionId: currentSessionId,
        workspacePath: workspacePath || '',
        expand: true,
      });
      resetIntentAfterSubmit('btw-thread');
      onBtwStarted?.();
    } catch (error) {
      log.error('Failed to start side question thread', { error });
      restoreDraftAfterFailure(originalDocument, originalContexts);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('btw.startFailed', { defaultValue: 'Side question failed' }),
        duration: 5000,
      });
    }
  }, [
    clearDraftForSubmit,
    currentSessionId,
    currentSessionModelId,
    contexts,
    document,
    isBtwSession,
    onBtwStarted,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    modelMessage,
    t,
    validateMessageSize,
    workspacePath,
  ]);

  const submitCompact = useCallback(async () => {
    if (!effectiveTargetSessionId || !effectiveTargetSession) {
      notificationService.error(t('chatInput.compactNoSession', { defaultValue: 'No active session for /compact' }));
      return;
    }
    if (derivedState?.isProcessing) {
      notificationService.warning(t('chatInput.compactBusy', { defaultValue: 'Wait until the session is idle before using /compact.' }));
      return;
    }
    if (inputValue.trim()) {
      notificationService.warning(t('chatInput.compactUsage', { defaultValue: 'Use /compact without extra arguments.' }));
      return;
    }

    clearDraftForSubmit();
    resetIntentAfterSubmit();

    try {
      const { agentAPI } = await import('@/infrastructure/api');
      await agentAPI.compactSession({
        locator: {
          session_id: effectiveTargetSessionId,
          domain: effectiveTargetSession.domain,
        },
      });
    } catch (error) {
      log.error('Failed to compact session', { error, sessionId: effectiveTargetSessionId });
      activateInput();
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.compactFailed', { defaultValue: 'Session compaction failed' }),
        duration: 5000,
      });
    }
  }, [
    activateInput,
    clearDraftForSubmit,
    derivedState?.isProcessing,
    effectiveTargetSession,
    effectiveTargetSessionId,
    inputValue,
    resetIntentAfterSubmit,
    t,
  ]);

  const submitInit = useCallback(async () => {
    if (!effectiveTargetSessionId || !effectiveTargetSession) {
      notificationService.error(t('chatInput.initNoSession', { defaultValue: 'No active session for /init' }));
      return;
    }
    if (derivedState?.isProcessing) {
      notificationService.warning(t('chatInput.initBusy', { defaultValue: 'Wait until the session is idle before using /init.' }));
      return;
    }
    if (inputValue.trim()) {
      notificationService.warning(t('chatInput.initUsage', { defaultValue: 'Use /init without extra arguments.' }));
      return;
    }

    const initInstruction = t('chatInput.initPrompt', {
      defaultValue: 'Please generate or update AGENTS.md so it matches the current project. Write it in English and keep the English version complete.',
    });

    clearDraftForSubmit();
    resetIntentAfterSubmit();

    try {
      await FlowChatManager.getInstance().sendMessage(
        initInstruction,
        effectiveTargetSessionId,
        initInstruction,
        'Init',
      );
      onSendMessage?.(initInstruction);
    } catch (error) {
      log.error('Failed to initialize workspace instructions', { error, sessionId: effectiveTargetSessionId });
      activateInput();
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.initFailed', { defaultValue: 'Session init failed' }),
        duration: 5000,
      });
    }
  }, [
    activateInput,
    clearDraftForSubmit,
    derivedState?.isProcessing,
    effectiveTargetSession,
    effectiveTargetSessionId,
    inputValue,
    onSendMessage,
    resetIntentAfterSubmit,
    t,
  ]);

  const submitGoalDraft = useCallback(async () => {
    if (!effectiveTargetSessionId || !effectiveTargetSession) {
      notificationService.error(t('chatInput.goalNoSession', { defaultValue: 'No active session for /goal' }));
      return;
    }

    const goalWorkspacePath = effectiveTargetSession.workspacePath || workspacePath || '';
    const supportsGoal = supportsSessionGoal({
      workspacePath: goalWorkspacePath,
      domain: effectiveTargetSession.domain,
      descriptor: effectiveTargetSession.descriptor,
    });
    if (!supportsGoal) {
      notificationService.warning(t('chatInput.goalUnsupported', { defaultValue: 'Goal mode is not supported in this session.' }));
      return;
    }

    const originalDocument = structuredClone(document);
    const originalContexts = structuredClone(contexts);
    const goalBody = modelMessage.trim();
    if (!goalBody) {
      notificationService.warning(t('chatInput.goalEmpty', { defaultValue: 'Describe the goal before sending.' }));
      return;
    }
    if (!validateMessageSize(goalBody)) {
      return;
    }

    const rawInput = `/goal ${goalBody}`;
    const goalTurnId = createGoalTurnId();

    addToHistory(effectiveTargetSessionId, displayMessage.trim(), composerContextSnapshot);
    clearDraftForSubmit();

    let goalTurnSubmitted = false;
    try {
      const { goalAPI } = await import('@/infrastructure/api');
      await sendMessage(goalBody, {
        displayMessage: displayMessage.trim(),
        triggerSource: 'goal',
        systemReminderOverride: goalInitialSystemReminder(),
        localDialogTurnId: goalTurnId,
        metadata: {
          composerContext: composerContextSnapshot,
          goal: {
            kind: 'initial',
            rawInput,
          },
        },
      });
      goalTurnSubmitted = true;

      const response = await goalAPI.submitSessionGoal({
        sessionId: effectiveTargetSessionId,
        workspacePath: goalWorkspacePath,
        rawInput,
        agentType: effectiveTargetSession.descriptor.agentPolicy.activeAgentId,
        turnId: goalTurnId,
        skipInitialContinuation: true,
      });
      useSessionGoalStore.getState().applyGoalResponse({
        sessionId: effectiveTargetSessionId,
        workspacePath: goalWorkspacePath,
        response,
      });
      resetIntentAfterSubmit();
    } catch (error) {
      log.error('Failed to submit goal', { error, sessionId: effectiveTargetSessionId });
      if (!goalTurnSubmitted) {
        restoreDraftAfterFailure(originalDocument, originalContexts);
      }
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.goalFailed', { defaultValue: 'Goal command failed' }),
        duration: 5000,
      });
    }
  }, [
    addToHistory,
    clearDraftForSubmit,
    effectiveTargetSession,
    effectiveTargetSessionId,
    composerContextSnapshot,
    contexts,
    displayMessage,
    document,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    sendMessage,
    modelMessage,
    t,
    validateMessageSize,
    workspacePath,
  ]);

  const submitMcpPrompt = useCallback(async () => {
    const command = intent.promptTemplate;
    if (!command) return;

    const originalDocument = structuredClone(document);
    const originalContexts = structuredClone(contexts);
    const originalMessage = displayMessage.trim();
    const expandedArguments = modelMessage.trim();
    const argValues = parseSlashArguments(expandedArguments);
    const requiredArgs = command.arguments.filter(argument => argument.required);
    if (argValues.length < requiredArgs.length) {
      notificationService.warning(t('chatInput.mcpPromptMissingArgs', {
        defaultValue: 'This MCP prompt requires arguments: {{args}}',
        args: requiredArgs.map(argument => argument.name).join(', '),
      }));
      return;
    }

    const commandDisplayMessage = `${command.command}${originalMessage ? ` ${originalMessage}` : ''}`;
    const commandComposerContext = createComposerContextSnapshot({
      version: 1,
      nodes: [
        { type: 'text', text: `${command.command}${document.nodes.length > 0 ? ' ' : ''}` },
        ...document.nodes,
      ],
    }, contexts);
    if (effectiveTargetSessionId) {
      addToHistory(effectiveTargetSessionId, commandDisplayMessage, commandComposerContext);
    }
    clearDraftForSubmit();

    try {
      const promptArguments = command.arguments.reduce<Record<string, string>>((acc, argument, index) => {
        const value = argValues[index];
        if (typeof value === 'string' && value.length > 0) {
          acc[argument.name] = value;
        }
        return acc;
      }, {});

      const prompt = await MCPAPI.getPrompt({
        serverId: command.serverId,
        promptName: command.promptName,
        arguments: Object.keys(promptArguments).length > 0 ? promptArguments : undefined,
      });

      const renderedPrompt = renderMcpPromptMessages(prompt.messages);
      if (!renderedPrompt.trim()) {
        throw new Error('MCP prompt returned no displayable content');
      }

      await sendMessage(renderedPrompt, {
        displayMessage: commandDisplayMessage,
        metadata: { composerContext: commandComposerContext },
      });
      resetIntentAfterSubmit();
    } catch (error) {
      log.error('Failed to run MCP prompt command', { command: command.command, error });
      restoreDraftAfterFailure(originalDocument, originalContexts);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.mcpPromptFailed', { defaultValue: 'MCP prompt failed' }),
        duration: 5000,
      });
    }
  }, [
    addToHistory,
    clearDraftForSubmit,
    effectiveTargetSessionId,
    contexts,
    displayMessage,
    document,
    intent.promptTemplate,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    sendMessage,
    modelMessage,
    t,
  ]);

  const handleCancelGeneration = useCallback(async () => {
    if (!effectiveTargetSessionId) return;
    await FlowChatManager.getInstance().cancelTaskForSession(effectiveTargetSessionId);
  }, [effectiveTargetSessionId]);

  const submitNormalMessage = useCallback(async () => {
    const originalDocument = structuredClone(document);
    const originalContexts = structuredClone(contexts);
    const message = modelMessage.trim();
    if (!message) return;
    if (!validateMessageSize(message)) {
      return;
    }

    if (effectiveTargetSessionId) {
      addToHistory(effectiveTargetSessionId, displayMessage.trim(), composerContextSnapshot);
    }
    clearDraftForSubmit();
    resetIntentAfterSubmit(intent.target === 'btw-thread' ? 'btw-thread' : undefined);

    try {
      await sendMessage(message, {
        displayMessage: displayMessage.trim(),
        metadata: {
          composerContext: composerContextSnapshot,
          ...(activeGoalId ? { goal: {
            kind: 'active',
            goalId: activeGoalId,
          } } : {}),
        },
      });
      clearInput();
    } catch (error) {
      log.error('Failed to send message', { error });
      restoreDraftAfterFailure(originalDocument, originalContexts);
    }
  }, [
    activeGoalId,
    addToHistory,
    clearDraftForSubmit,
    clearInput,
    composerContextSnapshot,
    contexts,
    displayMessage,
    document,
    effectiveTargetSessionId,
    intent.target,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    sendMessage,
    modelMessage,
    validateMessageSize,
  ]);

  const handleSendOrCancel = useCallback(async () => {
    if (!derivedState) return;

    const draftTrimmed = modelMessage.trim();
    if (derivedState.sendButtonMode === 'cancel' && !draftTrimmed && !intent.operation) {
      await handleCancelGeneration();
      return;
    }
    if (derivedState.sendButtonMode === 'retry') {
      await transition(SessionExecutionEvent.RESET);
    }

    if (intent.operation === 'compact') {
      await submitCompact();
      return;
    }
    if (intent.operation === 'init') {
      await submitInit();
      return;
    }
    if (intent.target === 'btw-draft') {
      await submitBtwDraft();
      return;
    }
    if (intent.promptTemplate) {
      await submitMcpPrompt();
      return;
    }
    if (hasComposerGoalModifier(intent)) {
      await submitGoalDraft();
      return;
    }

    await submitNormalMessage();
  }, [
    derivedState,
    handleCancelGeneration,
    intent,
    modelMessage,
    submitBtwDraft,
    submitCompact,
    submitGoalDraft,
    submitInit,
    submitMcpPrompt,
    submitNormalMessage,
    transition,
  ]);

  return {
    handleCancelGeneration,
    handleSendOrCancel,
  };
}
