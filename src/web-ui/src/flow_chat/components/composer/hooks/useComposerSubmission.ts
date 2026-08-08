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
import {
  estimateComposerSubmissionCharacters,
  getComposerText,
  hasSendableComposerSubmission,
  type ComposerDocument,
  type ComposerSubmissionEnvelope,
  type ContextReference,
} from '@/shared/types/composer';
import type { ContextItem, ImageContext } from '@/shared/types/context';
import type { ImageContextData } from '@/infrastructure/api/service-api/ImageContextTypes';
import {
  imageAssetFilePath,
  resolveImageAssetDataUrl,
} from '@/shared/media/imageAssetStore';
import {
  createComposerSubmissionEnvelope,
  createComposerContextSnapshot,
  freezeComposerDraftContextEditors,
  restoreComposerDraftContextEditors,
  serializeComposerDocumentForDisplay,
} from '../../../domain/composerContextRegistry';

const log = createLogger('ComposerSubmission');

type ComposerSendMessageOptions = {
  displayMessage?: string;
  metadata?: Record<string, any>;
  triggerSource?: import('@/shared/types/session-history').TriggerSource;
  systemReminderOverride?: string;
  localDialogTurnId?: string;
  composerSubmission?: ComposerSubmissionEnvelope;
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
  assets: ContextItem[];
  references: ContextReference[];
  restoreDraft: (
    document: ComposerDocument,
    assets: ContextItem[],
    references: ContextReference[],
  ) => void;
  restoreDraftIfEmpty: (
    document: ComposerDocument,
    assets: ContextItem[],
    references: ContextReference[],
  ) => boolean;
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

async function imageContextsForSubmission(
  assets: ContextItem[],
  submission: ComposerSubmissionEnvelope,
): Promise<ImageContextData[]> {
  const ordinalById = new Map(
    submission.attachments.map(attachment => [attachment.id, attachment.ordinal]),
  );
  return Promise.all(assets
    .filter((asset): asset is ImageContext => asset.type === 'image')
    .map(async asset => ({
        id: asset.id,
        image_path: imageAssetFilePath(asset),
        data_url: await resolveImageAssetDataUrl(asset),
        mime_type: asset.mimeType,
        metadata: {
          name: asset.imageName,
          width: asset.width,
          height: asset.height,
          file_size: asset.fileSize,
          source: asset.source,
          attachment_number: ordinalById.get(asset.id),
        },
      })));
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
  assets,
  references,
  restoreDraft,
  restoreDraftIfEmpty,
  updateDraftContext,
  draftKey,
  activeGoalId,
  onBtwStarted,
}: UseComposerSubmissionParams) {
  const validateSubmissionSize = useCallback((submission: ComposerSubmissionEnvelope): boolean => {
    const messageCharCount = estimateComposerSubmissionCharacters(submission);
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

  const displayMessage = serializeComposerDocumentForDisplay(document, references, assets, t);
  const composerContextSnapshot = createComposerContextSnapshot(document, references, assets);
  const normalSubmission = createComposerSubmissionEnvelope(
    document,
    references,
    assets,
    'normal',
    t,
  );
  const hasSendablePayload = hasSendableComposerSubmission(normalSubmission);
  const fallbackDisplayMessage = displayMessage.trim()
    || normalSubmission.attachments
      .map(attachment => `[Attachment ${attachment.ordinal}: ${attachment.title}]`)
      .join(' ');

  const clearDraftForSubmit = useCallback(() => {
    freezeComposerDraftContextEditors(composerContextSnapshot, draftKey);
    resetHistoryDraft();
    clearInput();
    setQueuedInput(null);
  }, [clearInput, composerContextSnapshot, draftKey, resetHistoryDraft, setQueuedInput]);

  const restoreDraftAfterFailure = useCallback((
    originalDocument: ComposerDocument,
    originalAssets: ContextItem[],
    originalReferences: ContextReference[],
  ) => {
    if (!restoreDraftIfEmpty(originalDocument, originalAssets, originalReferences)) return;
    const originalSnapshot = createComposerContextSnapshot(
      originalDocument,
      originalReferences,
      originalAssets,
    );
    restoreComposerDraftContextEditors(originalSnapshot, draftKey, updateDraftContext);
    activateInput();
    setInputValue(originalDocument.nodes
      .filter(node => node.type === 'text')
      .map(node => node.text)
      .join(''));
    restoreDraft(originalDocument, originalAssets, originalReferences);
    if (derivedState?.isProcessing) {
      setQueuedInput(fallbackDisplayMessage);
    }
  }, [
    activateInput,
    derivedState?.isProcessing,
    fallbackDisplayMessage,
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
    const originalAssets = structuredClone(assets);
    const originalReferences = structuredClone(references);
    const submission: ComposerSubmissionEnvelope = {
      ...normalSubmission,
      intent: 'btw',
    };
    const question = fallbackDisplayMessage;

    if (!hasSendableComposerSubmission(submission)) {
      notificationService.warning(t('btw.empty', { defaultValue: 'Please provide a side question.' }));
      return;
    }
    if (!validateSubmissionSize(submission)) {
      return;
    }

    clearDraftForSubmit();

    try {
      const { childSessionId } = await startBtwThread({
        parentSessionId: currentSessionId,
        workspacePath: workspacePath || '',
        question,
        modelId: currentSessionModelId,
        composerSubmission: submission,
        imageContexts: await imageContextsForSubmission(assets, submission),
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
      restoreDraftAfterFailure(originalDocument, originalAssets, originalReferences);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('btw.startFailed', { defaultValue: 'Side question failed' }),
        duration: 5000,
      });
    }
  }, [
    clearDraftForSubmit,
    currentSessionId,
    currentSessionModelId,
    assets,
    references,
    document,
    isBtwSession,
    onBtwStarted,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    fallbackDisplayMessage,
    normalSubmission,
    t,
    validateSubmissionSize,
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
    if (assets.length > 0) {
      notificationService.warning(t('input.context.unsupportedForOperation', {
        operation: '/compact',
        defaultValue: 'Attachments are not used by {{operation}}. Remove them before continuing.',
      }));
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
    assets.length,
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
    if (assets.length > 0) {
      notificationService.warning(t('input.context.unsupportedForOperation', {
        operation: '/init',
        defaultValue: 'Attachments are not used by {{operation}}. Remove them before continuing.',
      }));
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
    assets.length,
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
    const originalAssets = structuredClone(assets);
    const originalReferences = structuredClone(references);
    const submission: ComposerSubmissionEnvelope = {
      ...normalSubmission,
      intent: 'goal',
    };
    const goalBody = getComposerText(document).trim();
    if (!hasSendableComposerSubmission(submission)) {
      notificationService.warning(t('chatInput.goalEmpty', { defaultValue: 'Describe the goal before sending.' }));
      return;
    }
    if (!validateSubmissionSize(submission)) {
      return;
    }

    const rawInput = `/goal ${fallbackDisplayMessage}`;
    const goalTurnId = createGoalTurnId();

    addToHistory(effectiveTargetSessionId, fallbackDisplayMessage, composerContextSnapshot);
    clearDraftForSubmit();

    let goalTurnSubmitted = false;
    try {
      const { goalAPI } = await import('@/infrastructure/api');
      await sendMessage(goalBody, {
        displayMessage: fallbackDisplayMessage,
        triggerSource: 'goal',
        systemReminderOverride: goalInitialSystemReminder(),
        localDialogTurnId: goalTurnId,
        composerSubmission: submission,
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
        restoreDraftAfterFailure(originalDocument, originalAssets, originalReferences);
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
    assets,
    references,
    document,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    sendMessage,
    fallbackDisplayMessage,
    normalSubmission,
    t,
    validateSubmissionSize,
    workspacePath,
  ]);

  const submitMcpPrompt = useCallback(async () => {
    const command = intent.promptTemplate;
    if (!command) return;

    const originalDocument = structuredClone(document);
    const originalAssets = structuredClone(assets);
    const originalReferences = structuredClone(references);
    const originalMessage = displayMessage.trim();
    const expandedArguments = inputValue.trim();
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
      version: 2,
      nodes: [
        { type: 'text', text: `${command.command}${document.nodes.length > 0 ? ' ' : ''}` },
        ...document.nodes,
      ],
    }, references, assets);
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

      const promptSubmission = createComposerSubmissionEnvelope(
        { version: 2, nodes: [{ type: 'text', text: renderedPrompt }] },
        references,
        assets,
        'mcp_prompt',
        t,
      );
      if (!validateSubmissionSize(promptSubmission)) {
        throw new Error('MCP prompt and attachments exceed the Composer submission limit');
      }

      await sendMessage(renderedPrompt, {
        displayMessage: commandDisplayMessage,
        metadata: { composerContext: commandComposerContext },
        composerSubmission: promptSubmission,
      });
      resetIntentAfterSubmit();
    } catch (error) {
      log.error('Failed to run MCP prompt command', { command: command.command, error });
      restoreDraftAfterFailure(originalDocument, originalAssets, originalReferences);
      notificationService.error(error instanceof Error ? error.message : t('error.unknown'), {
        title: t('chatInput.mcpPromptFailed', { defaultValue: 'MCP prompt failed' }),
        duration: 5000,
      });
    }
  }, [
    addToHistory,
    clearDraftForSubmit,
    effectiveTargetSessionId,
    assets,
    references,
    displayMessage,
    document,
    intent.promptTemplate,
    inputValue,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    sendMessage,
    t,
    validateSubmissionSize,
  ]);

  const handleCancelGeneration = useCallback(async () => {
    if (!effectiveTargetSessionId) return;
    await FlowChatManager.getInstance().cancelTaskForSession(effectiveTargetSessionId);
  }, [effectiveTargetSessionId]);

  const submitNormalMessage = useCallback(async () => {
    const originalDocument = structuredClone(document);
    const originalAssets = structuredClone(assets);
    const originalReferences = structuredClone(references);
    const message = getComposerText(document).trim();
    if (!hasSendablePayload) return;
    if (!validateSubmissionSize(normalSubmission)) {
      return;
    }

    if (effectiveTargetSessionId) {
      addToHistory(effectiveTargetSessionId, fallbackDisplayMessage, composerContextSnapshot);
    }
    clearDraftForSubmit();
    resetIntentAfterSubmit(intent.target === 'btw-thread' ? 'btw-thread' : undefined);

    try {
      await sendMessage(message, {
        displayMessage: fallbackDisplayMessage,
        composerSubmission: normalSubmission,
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
      restoreDraftAfterFailure(originalDocument, originalAssets, originalReferences);
    }
  }, [
    activeGoalId,
    addToHistory,
    clearDraftForSubmit,
    clearInput,
    composerContextSnapshot,
    assets,
    references,
    document,
    effectiveTargetSessionId,
    intent.target,
    resetIntentAfterSubmit,
    restoreDraftAfterFailure,
    sendMessage,
    fallbackDisplayMessage,
    hasSendablePayload,
    normalSubmission,
    validateSubmissionSize,
  ]);

  const handleSendOrCancel = useCallback(async () => {
    if (!derivedState) return;

    if (derivedState.sendButtonMode === 'cancel' && !hasSendablePayload && !intent.operation) {
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
    hasSendablePayload,
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
    hasSendablePayload,
  };
}
