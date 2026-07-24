/**
 * Message handling module
 * Handles message sending, cancellation, and other operations
 */

import { agentAPI, type StartDialogTurnResponse } from '@/infrastructure/api/service-api/AgentAPI';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { AIModelConfig, DefaultModelsConfig } from '@/infrastructure/config/types';
import { notificationService } from '../../../shared/notification-system';
import { stateMachineManager } from '../../state-machine';
import { SessionExecutionEvent, SessionExecutionState } from '../../state-machine/types';
import { generateTempTitle } from '../../utils/titleUtils';
import { createLogger } from '@/shared/utils/logger';
import type { FlowChatContext, DialogTurn } from './types';
import { ensureBackendSession, retryCreateBackendSession } from './SessionModule';
import { cleanupSessionBuffers } from './TextChunkModule';
import type { ImageContextData as ImageInputContextData } from '@/infrastructure/api/service-api/ImageContextTypes';
import {
  acknowledgeFlowViewportTurnNavigation,
  requestFlowViewportTurnNavigation,
} from '../../scroll/viewport/FlowViewportNavigationBroker';
import {
  isTransientBtwSession,
  sendMessageToTransientBtwSession,
} from '../BtwThreadService';
import { finalizeFlowTurn } from '../../runtime/finalizers';
import { getBackendAgentType } from '../../domain/sessionDescriptor';
import { canHydrateSession, isSessionHydrating } from '../../domain/sessionLoadPhase';
import { useSessionTurnQueueStore } from '../../store/sessionTurnQueueStore';
import type { Session } from '../../types/flow-chat';
import { useWorkspaceSurfaceStore, selectFocusedSessionId } from '@/app/navigation/workspaceSurfaceStore';
import { i18nService } from '@/infrastructure/i18n';
import { resolveProfile } from '@/app/session-profiles';
import { settingsFlowSendErrorMessageKey } from '../../domain/settingsFlowSendError';

const log = createLogger('MessageModule');
export const MODEL_CONFIGURATION_REQUIRED_CODE = 'ai.model_not_configured';

export class ModelConfigurationRequiredError extends Error {
  readonly code = MODEL_CONFIGURATION_REQUIRED_CODE;

  constructor(readonly selector: string) {
    super(`${MODEL_CONFIGURATION_REQUIRED_CODE}: no enabled model resolves selector '${selector}'`);
    this.name = 'ModelConfigurationRequiredError';
  }
}

const ONE_SHOT_AGENT_TYPES_FOR_SESSION = new Set(['Init']);

function isMissingBackendSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /session\s+(?:does not exist|not found)|session metadata not found/i.test(message);
}

function resolveDialogAgentType(session: Session, requestedAgentType?: string): string {
  const sessionAgentType = getBackendAgentType(session.descriptor).trim() || 'Runno';
  const requested = requestedAgentType?.trim();

  if (!requested) {
    return sessionAgentType;
  }

  if (ONE_SHOT_AGENT_TYPES_FOR_SESSION.has(requested)) {
    return requested;
  }

  const policy = session.descriptor.agentPolicy;
  const allowed =
    requested === policy.activeAgentId ||
    requested === policy.defaultAgentId ||
    policy.switchableAgentIds.includes(requested);

  if (allowed) {
    return requested;
  }

  log.warn('Ignoring incompatible agent override for session', {
    sessionId: session.sessionId,
    requestedAgentType: requested,
    sessionAgentType,
    profileId: session.descriptor.profileId,
  });
  return sessionAgentType;
}

function isSessionBusyState(state: SessionExecutionState): boolean {
  return state === SessionExecutionState.PROCESSING || state === SessionExecutionState.FINISHING;
}

function isSessionBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /session (is )?(already running|still processing|already processing)|still busy|already busy/i.test(message);
}

async function ensureStartedProjection(sessionId: string, dialogTurnId: string): Promise<boolean> {
  const machine = stateMachineManager.get(sessionId);
  const currentState = machine?.getCurrentState() ?? SessionExecutionState.IDLE;
  const currentTurnId = machine?.getContext().currentDialogTurnId ?? null;

  if (isSessionBusyState(currentState)) {
    return currentTurnId === dialogTurnId;
  }

  return stateMachineManager.transition(sessionId, SessionExecutionEvent.START, {
    taskId: sessionId,
    dialogTurnId,
  });
}

function scheduleSubmittedTurnProjectionCheck(
  context: FlowChatContext,
  sessionId: string,
  dialogTurnId: string,
): void {
  const checkProjection = async () => {
    const session = context.flowChatStore.getState().sessions.get(sessionId);
    if (!session || session.dialogTurns.some(turn => turn.id === dialogTurnId)) {
      return;
    }

    const workspacePath = session.workspacePath?.trim();
    if (!workspacePath) {
      return;
    }

    try {
      await context.flowChatStore.loadSessionHistory(
        sessionId,
        workspacePath,
        session.domain,
        undefined,
      );
      log.info('Recovered submitted dialog turn from persisted history', {
        sessionId,
        dialogTurnId,
      });
    } catch (error) {
      log.warn('Failed to recover submitted dialog turn projection', {
        sessionId,
        dialogTurnId,
        error,
      });
    }
  };

  globalThis.setTimeout(() => { void checkProjection(); }, 250);
  globalThis.setTimeout(() => { void checkProjection(); }, 1500);
}

function normalizeModelSelection(
  modelId: string | undefined,
  models: AIModelConfig[],
  defaultModels: DefaultModelsConfig,
): string {
  const value = modelId?.trim();
  const selector = !value || value === 'default' ? 'primary' : value;
  const isEnabledModel = (id: string | null | undefined): boolean =>
    Boolean(id && models.some(model => model.enabled && model.id === id));

  if (selector === 'primary') {
    if (isEnabledModel(defaultModels.primary)) return 'primary';
    throw new ModelConfigurationRequiredError(selector);
  }

  if (selector === 'fast') {
    if (defaultModels.fast) {
      if (isEnabledModel(defaultModels.fast)) return 'fast';
      throw new ModelConfigurationRequiredError(selector);
    }
    if (isEnabledModel(defaultModels.primary)) return 'primary';
    throw new ModelConfigurationRequiredError(selector);
  }

  if (isEnabledModel(selector)) return selector;
  throw new ModelConfigurationRequiredError(selector);
}

async function resolveAgentModelSelection(agentType: string): Promise<string> {
  const [agentModels, allModels, defaultModels] = await Promise.all([
    configManager.getSetting<Record<string, string>>('core.ai.agent_models'),
    configManager.getSetting<AIModelConfig[]>('core.ai.models'),
    configManager.getSetting<DefaultModelsConfig>('core.ai.default_models'),
  ]);

  return normalizeModelSelection(
    (agentModels ?? {})[agentType],
    allModels ?? [],
    defaultModels ?? {},
  );
}

async function syncSessionModelSelection(
  context: FlowChatContext,
  sessionId: string,
  agentType: string,
  desiredModelId: string,
): Promise<void> {
  const session = context.flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }

  const currentModelId = (session.config.modelName || 'primary').trim() || 'primary';
  if (desiredModelId === currentModelId) {
    return;
  }

  await agentAPI.updateSessionModel({
    sessionId,
    modelName: desiredModelId,
  });
  context.flowChatStore.updateSessionModelName(sessionId, desiredModelId);

  log.info('Session model synchronized before send', {
    sessionId,
    agentType,
    previousModelId: currentModelId,
    nextModelId: desiredModelId,
  });
}

/**
 * Send message and handle response
 * @param message - Message sent to backend
 * @param sessionId - Session ID
 * @param displayMessage - Optional, message for UI display
 * @param agentType - Agent type
 * @param switchToMode - Optional inner agent switch for the session agent policy.
 */
export async function sendMessage(
  context: FlowChatContext,
  message: string,
  sessionId: string,
  displayMessage?: string,
  agentType?: string,
  switchToMode?: string,
  options?: {
    imageContexts?: ImageInputContextData[];
    imageDisplayData?: Array<{ id: string; name: string; dataUrl?: string; imagePath?: string; mimeType?: string }>;
    persistAgentType?: boolean;
    systemReminderOverride?: string;
    metadata?: Record<string, any>;
    triggerSource?: import('@/shared/types/session-history').TriggerSource;
    localDialogTurnId?: string;
  }
): Promise<void> {
  const session = context.flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session does not exist: ${sessionId}`);
  }

  if (switchToMode && switchToMode !== session.descriptor.agentPolicy.activeAgentId) {
    context.flowChatStore.updateSessionActiveAgent(sessionId, switchToMode);
  }

  let createdLocalTurnId: string | null = null;
  let createdNavigationRequestId: number | null = null;

  try {
    const refreshedSession = context.flowChatStore.getState().sessions.get(sessionId) ?? session;
    const requestedAgentType = agentType?.trim();
    const currentAgentType = resolveDialogAgentType(refreshedSession, requestedAgentType);
    const sessionProfile = resolveProfile(refreshedSession.descriptor.profileId);
    const runtimeOwnsModel = sessionProfile.capabilities.modelSelection === 'runtime-owned';
    const persistAgentType =
      options?.persistAgentType ?? !ONE_SHOT_AGENT_TYPES_FOR_SESSION.has(currentAgentType);
    const desiredModelId = runtimeOwnsModel
      ? 'primary'
      : await resolveAgentModelSelection(currentAgentType);

    if (
      requestedAgentType &&
      currentAgentType === requestedAgentType &&
      persistAgentType &&
      refreshedSession.descriptor.agentPolicy.activeAgentId !== currentAgentType
    ) {
      context.flowChatStore.updateSessionActiveAgent(sessionId, currentAgentType);
    }

    if (context.pendingHistoryLoads.has(sessionId)) {
      throw new Error('Session history is still restoring, please retry once loading finishes');
    }

    if (isTransientBtwSession(refreshedSession)) {
      if ((options?.imageContexts?.length ?? 0) > 0) {
        throw new Error('Transient /btw sessions do not support image attachments yet');
      }

      const parentSessionId = refreshedSession.parentSessionId?.trim();
      if (!parentSessionId) {
        throw new Error(`Transient /btw session is missing parentSessionId: ${sessionId}`);
      }

      await sendMessageToTransientBtwSession({
        parentSessionId,
        childSessionId: sessionId,
        question: message,
        childSessionName: refreshedSession.title,
        modelId: desiredModelId,
      });
      return;
    }

    await ensureBackendSession(context, sessionId);

    const readySession = context.flowChatStore.getState().sessions.get(sessionId);
    if (!readySession) {
      throw new Error(`Session lost before starting dialog turn: ${sessionId}`);
    }

    const isFirstMessage = sessionProfile.capabilities.autoTitle !== false
      && readySession.dialogTurns.length === 0
      && readySession.titleStatus !== 'generated';
    const dialogTurnId =
      options?.localDialogTurnId?.trim() ||
      `dialog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const hasImages = (options?.imageContexts?.length ?? 0) > 0;

    const dialogTurn: DialogTurn = {
      id: dialogTurnId,
      sessionId: sessionId,
      userMessage: {
        id: `user_${Date.now()}`,
        content: displayMessage || message,
        timestamp: Date.now(),
        hasImages,
        images: options?.imageDisplayData,
        metadata: options?.metadata,
        triggerSource: options?.triggerSource,
      },
      modelRounds: [],
      // Images are attached for multimodal primary models or reduced to text placeholders for text-only models.
      // We don't run a separate frontend "image pre-analysis" phase here.
      status: 'pending',
      startTime: Date.now()
    };

    context.flowChatStore.addDialogTurn(sessionId, dialogTurn);
    createdLocalTurnId = dialogTurnId;
    const navigationRequest = requestFlowViewportTurnNavigation({
      sessionId,
      turnId: dialogTurnId,
      behavior: 'auto',
      source: 'send-message',
    });
    createdNavigationRequestId = navigationRequest.requestId;

    const isRestoringHistoricalSession =
      canHydrateSession(readySession) ||
      isSessionHydrating(readySession) ||
      context.pendingHistoryLoads.has(sessionId);
    if (isRestoringHistoricalSession) {
      context.processingManager.clearSessionStatus(sessionId);
      context.flowChatStore.deleteDialogTurn(sessionId, dialogTurnId);
      acknowledgeFlowViewportTurnNavigation(sessionId, navigationRequest.requestId);
      throw new Error('Session history is still restoring, please retry once loading finishes');
    }

    if (!runtimeOwnsModel) {
      await syncSessionModelSelection(context, sessionId, currentAgentType, desiredModelId);
    }

    const updatedSession = context.flowChatStore.getState().sessions.get(sessionId);
    if (!updatedSession) {
      throw new Error(`Session lost after adding dialog turn: ${sessionId}`);
    }

    const workspacePath = updatedSession.workspacePath;
    let startResponse: StartDialogTurnResponse;
    
    try {
      startResponse = await agentAPI.startDialogTurn({
        sessionId: sessionId,
        userInput: message,
        originalUserInput: displayMessage || message,
        turnId: dialogTurnId,
        agentType: currentAgentType,
        systemReminderOverride: options?.systemReminderOverride,
        persistAgentType,
        workspacePath,
        triggerSource: options?.triggerSource,
        userMessageMetadata: options?.metadata,
        imageContexts: options?.imageContexts,
      });
    } catch (error: any) {
      if (isMissingBackendSessionError(error)) {
        log.warn('Backend session still not found, retrying creation', {
          sessionId: sessionId,
          dialogTurnsCount: updatedSession.dialogTurns.length
        });
        
        await retryCreateBackendSession(context, sessionId);
        
        startResponse = await agentAPI.startDialogTurn({
          sessionId: sessionId,
          userInput: message,
          originalUserInput: displayMessage || message,
          turnId: dialogTurnId,
          agentType: currentAgentType,
          systemReminderOverride: options?.systemReminderOverride,
          persistAgentType,
          workspacePath,
          triggerSource: options?.triggerSource,
          userMessageMetadata: options?.metadata,
          imageContexts: options?.imageContexts,
        });
      } else {
        throw error;
      }
    }

    const submittedTurnId = startResponse.turnId || dialogTurnId;
    const submitStatus = startResponse.status || 'started';

    if (submittedTurnId !== dialogTurnId) {
      log.warn('Backend returned a different dialog turn id', {
        sessionId,
        localTurnId: dialogTurnId,
        submittedTurnId,
      });
    }

    if (submitStatus === 'started') {
      const startOk = await ensureStartedProjection(sessionId, dialogTurnId);
      if (!startOk) {
        log.warn('Dialog turn started but frontend state was already owned by another turn', {
          sessionId,
          dialogTurnId,
        });
      }

      if (isFirstMessage) {
        handleTitleGeneration(context, sessionId, message);
      }

      context.processingManager.registerStatus({
        sessionId: sessionId,
        status: 'thinking',
        message: '',
        metadata: { sessionId: sessionId, dialogTurnId }
      });

      context.contentBuffers.set(sessionId, new Map());
      context.activeTextItems.set(sessionId, new Map());
      scheduleSubmittedTurnProjectionCheck(context, sessionId, dialogTurnId);
    } else {
      log.info('Dialog turn queued by scheduler', { sessionId, dialogTurnId });
      context.flowChatStore.deleteDialogTurn(sessionId, dialogTurnId);
      createdLocalTurnId = null;
      acknowledgeFlowViewportTurnNavigation(sessionId, navigationRequest.requestId);
      createdNavigationRequestId = null;
      void useSessionTurnQueueStore.getState().refreshQueue(sessionId);
    }

    const sessionStateMachine = stateMachineManager.get(sessionId);
    if (sessionStateMachine && submitStatus === 'started') {
      sessionStateMachine.getContext().taskId = sessionId;
    }

  } catch (error) {
    log.error('Failed to send message', { sessionId: sessionId, error });
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
    const isBusyRejection = isSessionBusyError(error);
    
    const state = context.flowChatStore.getState();
    const currentSession = state.sessions.get(sessionId);
    if (createdLocalTurnId && currentSession) {
      context.flowChatStore.deleteDialogTurn(sessionId, createdLocalTurnId);
    }
    if (createdNavigationRequestId !== null) {
      acknowledgeFlowViewportTurnNavigation(sessionId, createdNavigationRequestId);
    }
    
    const modelConfigurationRequired =
      error instanceof ModelConfigurationRequiredError ||
      errorMessage.includes(MODEL_CONFIGURATION_REQUIRED_CODE);
    const isSettingsProfile = currentSession?.descriptor.profileId === 'settings';

    if (modelConfigurationRequired) {
      notificationService.warning(
        i18nService.t('flow-chat/chat-input:modelRequired.message'),
        {
          title: i18nService.t('flow-chat/chat-input:modelRequired.title'),
          duration: 0,
          actions: [{
            label: i18nService.t('flow-chat/chat-input:modelRequired.action'),
            variant: 'primary',
            onClick: () => {
              void import('@/shared/services/ide-control/api').then(({ quickActions }) => {
                quickActions.openSettings('models');
              });
            },
          }],
        },
      );
    } else if (isSettingsProfile) {
      notificationService.error(
        i18nService.t(settingsFlowSendErrorMessageKey(error)),
        {
          title: i18nService.t('settings/ai-mode:session.sendErrors.title'),
          duration: 5000,
        },
      );
    } else {
      notificationService.error(errorMessage, {
        title: isBusyRejection ? 'Message was not queued' : 'Thinking process error',
        duration: 5000
      });
    }
    
    throw error;
  }
}

function handleTitleGeneration(
  context: FlowChatContext,
  sessionId: string,
  message: string
): void {
  const tempTitle = generateTempTitle(message, 20);
  // Show a readable placeholder immediately; backend later confirms the
  // authoritative title via AI or local fallback generation.
  context.flowChatStore.updateSessionTitle(sessionId, tempTitle, 'generating');
}

export async function cancelTaskForSession(
  context: FlowChatContext,
  sessionId: string
): Promise<boolean> {
  try {
    const currentState = stateMachineManager.getCurrentState(sessionId);
    const canCancel =
      currentState === SessionExecutionState.PROCESSING ||
      currentState === SessionExecutionState.FINISHING;
    if (!canCancel) {
      log.debug('Session not in cancellable state', { sessionId, currentState });
      return false;
    }

    const success = await stateMachineManager.transition(
      sessionId,
      SessionExecutionEvent.USER_CANCEL
    );

    if (success) {
      markCurrentTurnItemsAsCancelled(context, sessionId);
      cleanupSessionBuffers(context, sessionId);
    }

    return success;
  } catch (error) {
    log.error('Failed to cancel task for session', { sessionId, error });
    return false;
  }
}

export async function cancelCurrentTask(context: FlowChatContext): Promise<boolean> {
  const sessionId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());
  if (!sessionId) {
    log.debug('No focused session to cancel');
    return false;
  }
  return cancelTaskForSession(context, sessionId);
}

export function markCurrentTurnItemsAsCancelled(
  context: FlowChatContext,
  sessionId: string
): void {
  const state = context.flowChatStore.getState();
  const session = state.sessions.get(sessionId);
  if (!session) return;
  
  const lastDialogTurn = session.dialogTurns[session.dialogTurns.length - 1];
  if (!lastDialogTurn) return;
  
  if (lastDialogTurn.status === 'completed' || lastDialogTurn.status === 'cancelled') {
    return;
  }
  
  context.flowChatStore.updateDialogTurn(sessionId, lastDialogTurn.id, turn =>
    finalizeFlowTurn(turn, { settledAt: Date.now(), reason: 'user_cancelled' })
  );
}
