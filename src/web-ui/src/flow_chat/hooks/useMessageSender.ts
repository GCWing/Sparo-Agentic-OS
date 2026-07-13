/**
 * Message sending hook.
 * Encapsulates session creation, image uploads, and message assembly.
 *
 * Image handling is fully delegated to the backend coordinator which
 * decides whether to pre-analyse via a vision model or attach images
 * directly.  The frontend only uploads clipboard images and passes
 * ImageContextData[] through to the backend.
 */

import { useCallback } from 'react';
import { FlowChatManager } from '../services/FlowChatManager';
import { notificationService } from '@/shared/notification-system';
import type {
  ContextItem,
  ImageContext,
  SpreadsheetFocusContext,
} from '@/shared/types/context';
import type { TriggerSource } from '@/shared/types/session-history';
import type { AIModelConfig, DefaultModelsConfig } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';
import { descriptorFromAgentType } from '../domain/sessionDescriptor';
import {
  isSpreadsheetFocusBoundToSession,
  spreadsheetFocusMetadata,
  useExcelLiveFocusStore,
} from '@/app/agentic-os/excel-live/excelLiveFocusStore';
import { formatSpreadsheetFocusContext } from '../domain/composerContextRegistry';
import { getComposerContextIds, isComposerContextSnapshot } from '@/shared/types/composer';

const log = createLogger('FlowChat');

function normalizeModelSelection(
  modelId: string | undefined,
  models: AIModelConfig[],
  defaultModels: DefaultModelsConfig,
): string {
  const value = modelId?.trim();
  if (!value || value === 'default') return 'primary';

  if (value === 'primary' || value === 'fast') {
    const resolvedDefaultId = value === 'primary' ? defaultModels.primary : defaultModels.fast;
    const matchedModel = models.find(model => model.id === resolvedDefaultId);
    return matchedModel ? value : 'primary';
  }

  const matchedModel = models.find(model =>
    model.id === value || model.name === value || model.model_name === value,
  );
  return matchedModel ? value : 'primary';
}

interface UseMessageSenderProps {
  /** Current session ID */
  currentSessionId?: string;
  /** Context items */
  contexts: ContextItem[];
  /** Success callback */
  onSuccess?: (message: string) => void;
  /** Exit template mode callback */
  onExitTemplateMode?: () => void;
  /** Selected agent type (mode) */
  currentAgentType?: string;
}

interface UseMessageSenderReturn {
  /** Send a message */
  sendMessage: (
    message: string,
    options?: {
      displayMessage?: string;
      metadata?: Record<string, any>;
      triggerSource?: TriggerSource;
      systemReminderOverride?: string;
      localDialogTurnId?: string;
    }
  ) => Promise<void>;
  /** Whether a send is in progress */
  isSending: boolean;
}

export function useMessageSender(props: UseMessageSenderProps): UseMessageSenderReturn {
  const {
    currentSessionId,
    contexts,
    onSuccess,
    onExitTemplateMode,
    currentAgentType,
  } = props;

  const sendMessage = useCallback(async (
    message: string,
    options?: {
      displayMessage?: string;
      metadata?: Record<string, any>;
      triggerSource?: TriggerSource;
      systemReminderOverride?: string;
      localDialogTurnId?: string;
    }
  ) => {
    if (!message.trim()) {
      return;
    }

    const trimmedMessage = message.trim();
    let sessionId = currentSessionId;
    log.debug('Send message initiated', {
      textLength: trimmedMessage.length,
      contextCount: contexts.length,
      hasSession: !!sessionId,
      composerAgentType: currentAgentType || 'Runno',
    });

    try {
      const flowChatManager = FlowChatManager.getInstance();

      if (!sessionId) {
        const { configManager } = await import('@/infrastructure/config/services/ConfigManager');
        const [agentModels, allModels, defaultModels] = await Promise.all([
          configManager.getConfig<Record<string, string>>('ai.agent_models') || {},
          configManager.getConfig<AIModelConfig[]>('ai.models') || [],
          configManager.getConfig<DefaultModelsConfig>('ai.default_models') || {},
        ]);
        const agentType = currentAgentType || 'Runno';
        const modelId = normalizeModelSelection(agentModels[agentType], allModels, defaultModels);

        sessionId = await flowChatManager.createChatSession({
          modelName: modelId || undefined
        }, descriptorFromAgentType(agentType));
        log.debug('Session created', { sessionId, modelId, agentType });
      } else {
        log.debug('Reusing existing session', { sessionId });
      }

      const focusState = useExcelLiveFocusStore.getState();
      const ambientCandidate = focusState.includeOnSend
        ? focusState.getAmbientForSession(sessionId)
        : null;
      // Only attach ambient spreadsheet focus to the chat session that is
      // actually bound to the Excel Live surface which produced it.
      const ambientFocus = ambientCandidate
        && isSpreadsheetFocusBoundToSession(ambientCandidate, sessionId)
        ? ambientCandidate
        : null;
      // ContextStore is global and pinned tags can outlive a surface. Reject
      // every spreadsheet context that is not bound to this exact session,
      // and replace any stored ambient copy with the single latest snapshot.
      const sessionContexts = contexts.filter((context) => (
        context.type !== 'spreadsheet-focus'
        || isSpreadsheetFocusBoundToSession(context, sessionId)
      ));
      const explicitContexts = sessionContexts.filter((context) => (
        context.type !== 'spreadsheet-focus' || context.role !== 'ambient'
      ));
      const mergedContexts: ContextItem[] = ambientFocus
        ? [ambientFocus, ...explicitContexts]
        : explicitContexts;

      const imageContexts = mergedContexts.filter(ctx => ctx.type === 'image') as ImageContext[];
      const clipboardImages = imageContexts.filter(ctx => !ctx.isLocal && ctx.dataUrl);

      if (clipboardImages.length > 0) {
        try {
          const { api } = await import('@/infrastructure/api/service-api/ApiClient');
          const uploadData = {
            request: {
              images: clipboardImages.map(ctx => ({
                id: ctx.id,
                image_path: ctx.imagePath || null,
                data_url: ctx.dataUrl || null,
                mime_type: ctx.mimeType,
                image_name: ctx.imageName,
                file_size: ctx.fileSize,
                width: ctx.width || null,
                height: ctx.height || null,
                source: ctx.source,
              }))
            }
          };

          await api.invoke('upload_image_contexts', uploadData);
          log.debug('Clipboard images uploaded', {
            imageCount: clipboardImages.length,
            ids: clipboardImages.map(img => img.id),
          });
        } catch (error) {
          log.error('Failed to upload clipboard images', {
            imageCount: clipboardImages.length,
            error: (error as Error)?.message ?? 'unknown',
          });
          notificationService.error('Image upload failed. Please try again.', { duration: 3000 });
          throw error;
        }
      }

      let fullMessage = trimmedMessage;
      const displayMessage = options?.displayMessage?.trim() || trimmedMessage;
      const sendCapturedAt = Date.now();

      const submittedComposerContext = options?.metadata?.composerContext;
      const referencedContextIds = isComposerContextSnapshot(submittedComposerContext)
        ? new Set(getComposerContextIds(submittedComposerContext.document))
        : new Set<string>();
      if (ambientFocus && !referencedContextIds.has(ambientFocus.id)) {
        fullMessage = `${trimmedMessage}\n\n${formatSpreadsheetFocusContext(ambientFocus, sendCapturedAt)}`;
      }

      // Always pass imageContexts to the backend; the coordinator decides
      // whether to pre-analyse via a vision model or attach directly.
      const imageContextsForBackend = imageContexts.length > 0
        ? {
            imageContexts: imageContexts.map(ctx => ({
              id: ctx.id,
              image_path: ctx.isLocal ? ctx.imagePath : undefined,
              data_url: undefined,
              mime_type: ctx.mimeType,
              metadata: {
                name: ctx.imageName,
                width: ctx.width,
                height: ctx.height,
                file_size: ctx.fileSize,
                source: ctx.source,
              },
            })),
            imageDisplayData: imageContexts.map(ctx => ({
              id: ctx.id,
              name: ctx.imageName || 'Image',
              dataUrl: ctx.dataUrl,
              imagePath: ctx.isLocal ? ctx.imagePath : undefined,
              mimeType: ctx.mimeType,
            })),
          }
        : undefined;

      const spreadsheetContexts = mergedContexts.filter(
        (context): context is SpreadsheetFocusContext => context.type === 'spreadsheet-focus',
      );
      const spreadsheetFocusMessageMetadata = spreadsheetContexts.length > 0
        ? {
            capturedForSendAt: sendCapturedAt,
            ambient: ambientFocus ? spreadsheetFocusMetadata(ambientFocus) : null,
            pinned: spreadsheetContexts
              .filter(context => context.role === 'pinned')
              .map(spreadsheetFocusMetadata),
          }
        : undefined;
      const messageMetadata = spreadsheetFocusMessageMetadata
        ? {
            ...(options?.metadata ?? {}),
            spreadsheetFocus: spreadsheetFocusMessageMetadata,
          }
        : options?.metadata;

      await flowChatManager.sendMessage(
        fullMessage,
        sessionId || undefined,
        displayMessage,
        undefined,
        undefined,
        {
          ...imageContextsForBackend,
          metadata: messageMetadata,
          triggerSource: options?.triggerSource,
          systemReminderOverride: options?.systemReminderOverride,
          localDialogTurnId: options?.localDialogTurnId,
        }
      );

      onExitTemplateMode?.();

      onSuccess?.(trimmedMessage);
      log.info('Message sent successfully', {
        sessionId,
        composerAgentType: currentAgentType || 'Runno',
        contextCount: mergedContexts.length,
        imageCount: imageContexts.length,
      });
    } catch (error) {
      log.error('Failed to send message', {
        sessionId,
        composerAgentType: currentAgentType || 'Runno',
        contextCount: contexts.length,
        error: (error as Error)?.message ?? 'unknown',
      });
      throw error;
    }
  }, [currentSessionId, contexts, onSuccess, onExitTemplateMode, currentAgentType]);

  return {
    sendMessage,
    isSending: false,
  };
}
