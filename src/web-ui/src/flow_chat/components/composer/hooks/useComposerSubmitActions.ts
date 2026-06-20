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
  type SlashMcpPromptItem,
} from '../model/composerCommands';
import {
  isExactBuiltinSlashCommand,
  matchesBuiltinSlashCommand,
} from '../model/builtinSlashCommands';
import type { ComposerSlashCommandState } from '../model/composerState';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ComposerSubmitActions');

type ComposerSendMessageOptions = {
  displayMessage?: string;
  metadata?: Record<string, any>;
  triggerSource?: import('@/shared/types/session-history').TriggerSource;
  systemReminderOverride?: string;
  localDialogTurnId?: string;
};

interface UseComposerSubmitActionsParams {
  t: TFunction<'flow-chat'>;
  inputValue: string;
  setInputValue: (value: string) => void;
  activateInput: () => void;
  clearInput: () => void;
  setQueuedInput: (value: string | null) => void;
  setSlashCommandState: (state: ComposerSlashCommandState) => void;
  currentSessionId?: string | null;
  currentSession?: Session;
  currentSessionModelId: string;
  effectiveTargetSessionId?: string | null;
  effectiveTargetSession?: Session;
  workspacePath?: string;
  isBtwSession: boolean;
  derivedState: SessionDerivedState | null;
  transition: (event: SessionExecutionEvent) => Promise<unknown>;
  sendMessage: (message: string, options?: ComposerSendMessageOptions) => Promise<void>;
  addToHistory: (sessionId: string, message: string) => void;
  resetHistoryDraft: () => void;
  onSendMessage?: (message: string) => void;
  clearPendingLargePastes: () => void;
  expandPendingLargePastes: (text: string) => string;
  getCharacterCount: (text: string) => number;
  snapshotPendingLargePastes: () => Record<string, string>;
  restorePendingLargePastes: (snapshot: Record<string, string>) => void;
  loadMcpPromptCommands: () => Promise<void>;
  resolveTypedMcpPromptCommand: (text: string) => SlashMcpPromptItem | null;
  onBtwStarted?: () => void;
}

const closedSlashState: ComposerSlashCommandState = {
  isActive: false,
  kind: 'agents',
  query: '',
  selectedIndex: 0,
};

const GOAL_CONTROL_COMMANDS = new Set(['', 'status', 'pause', 'resume', 'clear', 'cancel', 'review']);

function stripGoalCommand(message: string): string {
  return message.trim().replace(/^\/goal\b/i, '').trim();
}

function isGoalControlCommand(body: string): boolean {
  return GOAL_CONTROL_COMMANDS.has(body.trim().toLowerCase());
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

export function useComposerSubmitActions({
  t,
  inputValue,
  setInputValue,
  activateInput,
  clearInput,
  setQueuedInput,
  setSlashCommandState,
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
  clearPendingLargePastes,
  expandPendingLargePastes,
  getCharacterCount,
  snapshotPendingLargePastes,
  restorePendingLargePastes,
  loadMcpPromptCommands,
  resolveTypedMcpPromptCommand,
  onBtwStarted,
}: UseComposerSubmitActionsParams) {
  const submitBtwFromInput = useCallback(async () => {
    if (!derivedState) return;
    if (!currentSessionId) {
      notificationService.error(t('btw.noSession', { defaultValue: 'No active session for /btw' }));
      return;
    }
    if (isBtwSession) {
      notificationService.warning(t('btw.nestedDisabled', { defaultValue: 'Side questions cannot create another side question' }));
      return;
    }

    const originalMessage = inputValue.trim();
    const originalPendingLargePastes = snapshotPendingLargePastes();
    const message = expandPendingLargePastes(originalMessage).trim();
    const messageCharCount = getCharacterCount(message);
    const question = message.replace(/^\/btw\b/i, '').trim();

    clearInput();
    clearPendingLargePastes();
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);

    if (!question) {
      notificationService.warning(t('btw.empty', { defaultValue: 'Please provide a question after /btw' }));
      return;
    }

    if (messageCharCount > CHAT_INPUT_CONFIG.largePaste.maxMessageChars) {
      notificationService.error(
        t('input.messageTooLarge', {
          max: CHAT_INPUT_CONFIG.largePaste.maxMessageChars,
          count: messageCharCount,
          defaultValue: 'Message exceeds the maximum length of {{max}} characters ({{count}} provided).',
        }),
        { duration: 4000 }
      );
      restorePendingLargePastes(originalPendingLargePastes);
      activateInput();
      setInputValue(originalMessage);
      return;
    }

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
      onBtwStarted?.();
    } catch (e) {
      log.error('Failed to start /btw thread', { e });
      activateInput();
      restorePendingLargePastes(originalPendingLargePastes);
      setInputValue(originalMessage);
    }
  }, [
    activateInput,
    clearInput,
    clearPendingLargePastes,
    currentSessionId,
    currentSessionModelId,
    derivedState,
    expandPendingLargePastes,
    getCharacterCount,
    inputValue,
    isBtwSession,
    restorePendingLargePastes,
    setInputValue,
    setQueuedInput,
    setSlashCommandState,
    snapshotPendingLargePastes,
    t,
    workspacePath,
    onBtwStarted,
  ]);

  const submitCompactFromInput = useCallback(async () => {
    if (!effectiveTargetSessionId || !effectiveTargetSession) {
      notificationService.error(t('chatInput.compactNoSession', { defaultValue: 'No active session for /compact' }));
      return;
    }
    if (derivedState?.isProcessing) {
      notificationService.warning(t('chatInput.compactBusy', { defaultValue: 'Wait until the session is idle before using /compact.' }));
      return;
    }

    const message = inputValue.trim();
    if (!/^\/compact\s*$/i.test(message)) {
      notificationService.warning(t('chatInput.compactUsage', { defaultValue: 'Use /compact without extra arguments.' }));
      return;
    }

    clearInput();
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);

    try {
      const { agentAPI } = await import('@/infrastructure/api');
      await agentAPI.compactSession({
        sessionId: effectiveTargetSessionId,
        workspacePath: effectiveTargetSession.workspacePath,
        storageScope: effectiveTargetSession.storageScope,
      });
    } catch (error) {
      log.error('Failed to trigger /compact', { error, sessionId: effectiveTargetSessionId });
      activateInput();
      setInputValue(message);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.compactFailed', { defaultValue: 'Session compaction failed' }),
        duration: 5000,
      });
    }
  }, [activateInput, clearInput, derivedState?.isProcessing, effectiveTargetSession, effectiveTargetSessionId, inputValue, setInputValue, setQueuedInput, setSlashCommandState, t]);

  const submitInitFromInput = useCallback(async () => {
    if (!effectiveTargetSessionId || !effectiveTargetSession) {
      notificationService.error(t('chatInput.initNoSession', { defaultValue: 'No active session for /init' }));
      return;
    }
    if (derivedState?.isProcessing) {
      notificationService.warning(t('chatInput.initBusy', { defaultValue: 'Wait until the session is idle before using /init.' }));
      return;
    }

    const message = inputValue.trim();
    if (!/^\/init\s*$/i.test(message)) {
      notificationService.warning(t('chatInput.initUsage', { defaultValue: 'Use /init without extra arguments.' }));
      return;
    }

    const initInstruction = t('chatInput.initPrompt', {
      defaultValue: 'Please generate or update AGENTS.md so it matches the current project. Write it in English and keep the English version complete.',
    });

    clearInput();
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);

    try {
      await FlowChatManager.getInstance().sendMessage(
        initInstruction,
        effectiveTargetSessionId,
        initInstruction,
        'Init'
      );
      onSendMessage?.(initInstruction);
    } catch (error) {
      log.error('Failed to trigger /init', { error, sessionId: effectiveTargetSessionId });
      activateInput();
      setInputValue(message);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.initFailed', { defaultValue: 'Session init failed' }),
        duration: 5000,
      });
    }
  }, [activateInput, clearInput, derivedState?.isProcessing, effectiveTargetSession, effectiveTargetSessionId, inputValue, onSendMessage, setInputValue, setQueuedInput, setSlashCommandState, t]);

  const submitGoalFromInput = useCallback(async () => {
    if (!effectiveTargetSessionId || !effectiveTargetSession) {
      notificationService.error(t('chatInput.goalNoSession', { defaultValue: 'No active session for /goal' }));
      return;
    }

    const goalWorkspacePath = effectiveTargetSession.workspacePath || workspacePath || '';
    const supportsGoal = supportsSessionGoal({
      workspacePath: goalWorkspacePath,
      storageScope: effectiveTargetSession.storageScope,
      descriptor: effectiveTargetSession.descriptor,
    });
    if (!supportsGoal) {
      notificationService.warning(t('chatInput.goalUnsupported', { defaultValue: 'Goal mode is not supported in this session.' }));
      return;
    }

    const originalMessage = inputValue.trim();
    const originalPendingLargePastes = snapshotPendingLargePastes();
    const message = expandPendingLargePastes(originalMessage).trim();
    const messageCharCount = getCharacterCount(message);

    if (messageCharCount > CHAT_INPUT_CONFIG.largePaste.maxMessageChars) {
      notificationService.error(t('input.messageTooLarge', {
        max: CHAT_INPUT_CONFIG.largePaste.maxMessageChars,
        count: messageCharCount,
        defaultValue: 'Message exceeds the maximum length of {{max}} characters ({{count}} provided).',
      }), { duration: 4000 });
      restorePendingLargePastes(originalPendingLargePastes);
      activateInput();
      setInputValue(originalMessage);
      return;
    }

    const goalBody = stripGoalCommand(message);
    const isControlCommand = isGoalControlCommand(goalBody);
    const goalTurnId = createGoalTurnId();

    addToHistory(effectiveTargetSessionId, originalMessage);
    resetHistoryDraft();
    clearInput();
    clearPendingLargePastes();
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);

    let goalTurnSubmitted = false;
    try {
      const { goalAPI } = await import('@/infrastructure/api');
      if (!isControlCommand) {
        await sendMessage(goalBody, {
          displayMessage: goalBody,
          triggerSource: 'goal',
          systemReminderOverride: goalInitialSystemReminder(),
          localDialogTurnId: goalTurnId,
          metadata: {
            goal: {
              kind: 'initial',
              rawInput: message,
            },
          },
        });
        goalTurnSubmitted = true;
      }
      const response = await goalAPI.submitSessionGoal({
        sessionId: effectiveTargetSessionId,
        workspacePath: goalWorkspacePath,
        rawInput: message,
        agentType: effectiveTargetSession.descriptor.agentPolicy.activeAgentId,
        turnId: isControlCommand ? `goal-command-${Date.now()}` : goalTurnId,
        skipInitialContinuation: true,
      });
      useSessionGoalStore.getState().applyGoalResponse({
        sessionId: effectiveTargetSessionId,
        workspacePath: goalWorkspacePath,
        response,
      });
    } catch (error) {
      log.error('Failed to trigger /goal', { error, sessionId: effectiveTargetSessionId });
      if (!goalTurnSubmitted) {
        restorePendingLargePastes(originalPendingLargePastes);
        activateInput();
        setInputValue(originalMessage);
      }
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.goalFailed', { defaultValue: 'Goal command failed' }),
        duration: 5000,
      });
    }
  }, [
    activateInput,
    addToHistory,
    clearInput,
    clearPendingLargePastes,
    effectiveTargetSession,
    effectiveTargetSessionId,
    expandPendingLargePastes,
    getCharacterCount,
    inputValue,
    resetHistoryDraft,
    restorePendingLargePastes,
    sendMessage,
    setInputValue,
    setQueuedInput,
    setSlashCommandState,
    snapshotPendingLargePastes,
    t,
    workspacePath,
  ]);

  const submitMcpPromptFromInput = useCallback(async () => {
    const originalMessage = inputValue.trim();
    let command = resolveTypedMcpPromptCommand(originalMessage);

    if (!command) {
      await loadMcpPromptCommands();
      command = resolveTypedMcpPromptCommand(originalMessage);
    }

    if (!command) {
      notificationService.warning(t('chatInput.noMatchingCommand', { defaultValue: 'No matching command' }));
      return;
    }

    const argValues = parseSlashArguments(originalMessage.slice(command.command.length).trim());
    const requiredArgs = command.arguments.filter(argument => argument.required);
    if (argValues.length < requiredArgs.length) {
      notificationService.warning(t('chatInput.mcpPromptMissingArgs', {
        defaultValue: 'This MCP prompt requires arguments: {{args}}',
        args: requiredArgs.map(argument => argument.name).join(', '),
      }));
      return;
    }

    const originalPendingLargePastes = snapshotPendingLargePastes();
    if (effectiveTargetSessionId) {
      addToHistory(effectiveTargetSessionId, originalMessage);
    }
    resetHistoryDraft();
    clearInput();
    clearPendingLargePastes();
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);

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

      await sendMessage(renderedPrompt, { displayMessage: originalMessage });
    } catch (error) {
      log.error('Failed to run MCP prompt command', { command: originalMessage, error });
      restorePendingLargePastes(originalPendingLargePastes);
      activateInput();
      setInputValue(originalMessage);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.mcpPromptFailed', { defaultValue: 'MCP prompt failed' }),
        duration: 5000,
      });
    }
  }, [activateInput, addToHistory, clearInput, clearPendingLargePastes, effectiveTargetSessionId, inputValue, loadMcpPromptCommands, resetHistoryDraft, resolveTypedMcpPromptCommand, restorePendingLargePastes, sendMessage, setInputValue, setQueuedInput, setSlashCommandState, snapshotPendingLargePastes, t]);

  const handleCancelGeneration = useCallback(async () => {
    if (!effectiveTargetSessionId) return;
    await FlowChatManager.getInstance().cancelTaskForSession(effectiveTargetSessionId);
  }, [effectiveTargetSessionId]);

  const handleSendOrCancel = useCallback(async () => {
    if (!derivedState) return;

    const { sendButtonMode } = derivedState;
    const draftTrimmed = inputValue.trim();
    if (sendButtonMode === 'cancel' && !draftTrimmed) {
      await handleCancelGeneration();
      return;
    }
    if (sendButtonMode === 'retry') {
      await transition(SessionExecutionEvent.RESET);
    }
    if (!draftTrimmed) return;

    const originalMessage = draftTrimmed;
    const originalPendingLargePastes = snapshotPendingLargePastes();
    const message = expandPendingLargePastes(originalMessage).trim();
    const messageCharCount = getCharacterCount(message);

    if (matchesBuiltinSlashCommand(message, 'btw')) {
      await submitBtwFromInput();
      return;
    }
    if (isExactBuiltinSlashCommand(message, 'compact')) {
      await submitCompactFromInput();
      return;
    }
    if (isExactBuiltinSlashCommand(message, 'init')) {
      await submitInitFromInput();
      return;
    }
    if (matchesBuiltinSlashCommand(message, 'goal')) {
      await submitGoalFromInput();
      return;
    }
    if (resolveTypedMcpPromptCommand(message)) {
      await submitMcpPromptFromInput();
      return;
    }

    if (matchesBuiltinSlashCommand(message, 'compact')) {
      notificationService.warning(t('chatInput.compactUsage', { defaultValue: 'Use /compact without extra arguments.' }));
      return;
    }
    if (matchesBuiltinSlashCommand(message, 'init')) {
      notificationService.warning(t('chatInput.initUsage', { defaultValue: 'Use /init without extra arguments.' }));
      return;
    }
    if (effectiveTargetSessionId) {
      addToHistory(effectiveTargetSessionId, message);
    }
    resetHistoryDraft();
    clearInput();
    clearPendingLargePastes();
    setQueuedInput(null);

    if (messageCharCount > CHAT_INPUT_CONFIG.largePaste.maxMessageChars) {
      notificationService.error(t('input.messageTooLarge', {
        max: CHAT_INPUT_CONFIG.largePaste.maxMessageChars,
        count: messageCharCount,
        defaultValue: 'Message exceeds the maximum length of {{max}} characters ({{count}} provided).',
      }), { duration: 4000 });
      restorePendingLargePastes(originalPendingLargePastes);
      activateInput();
      setInputValue(originalMessage);
      return;
    }

    try {
      await sendMessage(message);
      clearPendingLargePastes();
      clearInput();
    } catch (error) {
      log.error('Failed to send message', { error });
      restorePendingLargePastes(originalPendingLargePastes);
      activateInput();
      setInputValue(originalMessage);
      if (derivedState?.isProcessing) {
        setQueuedInput(originalMessage);
      }
    }
  }, [activateInput, addToHistory, clearInput, clearPendingLargePastes, derivedState, effectiveTargetSessionId, expandPendingLargePastes, getCharacterCount, handleCancelGeneration, inputValue, resetHistoryDraft, resolveTypedMcpPromptCommand, restorePendingLargePastes, sendMessage, setInputValue, setQueuedInput, snapshotPendingLargePastes, submitBtwFromInput, submitCompactFromInput, submitGoalFromInput, submitInitFromInput, submitMcpPromptFromInput, t, transition]);

  return {
    handleCancelGeneration,
    handleSendOrCancel,
    submitBtwFromInput,
    submitCompactFromInput,
    submitGoalFromInput,
    submitInitFromInput,
    submitMcpPromptFromInput,
  };
}
