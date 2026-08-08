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
import {
  imageAssetFilePath,
  resolveImageAssetDataUrl,
} from '@/shared/media/imageAssetStore';
import { descriptorFromAgentType } from '../domain/sessionDescriptor';
import {
  isSpreadsheetFocusBoundToSession,
  spreadsheetFocusMetadata,
  useExcelLiveFocusStore,
} from '@/app/agentic-os/excel-live/excelLiveFocusStore';
import { formatSpreadsheetFocusContext } from '../domain/composerContextRegistry';
import {
  hasSendableComposerSubmission,
  type ComposerSubmissionEnvelope,
} from '@/shared/types/composer';

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

export interface MessageSendContext {
  metadata?: Record<string, unknown>;
  triggerSource?: TriggerSource;
  systemReminderOverride?: string;
}

export type ResolveMessageSendContext = (input: {
  message: string;
  sessionId: string;
}) => MessageSendContext | undefined | Promise<MessageSendContext | undefined>;

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
  /** Surface-owned metadata/context resolved immediately before each turn starts. */
  resolveSendContext?: ResolveMessageSendContext;
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
      composerSubmission?: ComposerSubmissionEnvelope;
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
    resolveSendContext,
  } = props;

  const sendMessage = useCallback(async (
    message: string,
    options?: {
      displayMessage?: string;
      metadata?: Record<string, any>;
      triggerSource?: TriggerSource;
      systemReminderOverride?: string;
      localDialogTurnId?: string;
      composerSubmission?: ComposerSubmissionEnvelope;
    }
  ) => {
    if (!message.trim() && !(
      options?.composerSubmission
      && hasSendableComposerSubmission(options.composerSubmission)
    )) {
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
          configManager.getSetting<Record<string, string>>('core.ai.agent_models') || {},
          configManager.getSetting<AIModelConfig[]>('core.ai.models') || [],
          configManager.getSetting<DefaultModelsConfig>('core.ai.default_models') || {},
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
      const resolvedImageContexts = await Promise.all(imageContexts.map(async context => ({
        context,
        imagePath: imageAssetFilePath(context),
        dataUrl: await resolveImageAssetDataUrl(context),
      })));
      const uploadableImages = resolvedImageContexts.filter(image => Boolean(image.dataUrl));

      if (uploadableImages.length > 0) {
        try {
          const { api } = await import('@/infrastructure/api/service-api/ApiClient');
          const uploadData = {
            request: {
              images: uploadableImages.map(({ context, imagePath, dataUrl }) => ({
                id: context.id,
                image_path: imagePath || null,
                data_url: dataUrl || null,
                mime_type: context.mimeType,
                image_name: context.imageName,
                file_size: context.fileSize,
                width: context.width || null,
                height: context.height || null,
                source: context.source,
              }))
            }
          };

          await api.invoke('upload_image_contexts', uploadData);
          log.debug('Clipboard images uploaded', {
            imageCount: uploadableImages.length,
            ids: uploadableImages.map(image => image.context.id),
          });
        } catch (error) {
          log.error('Failed to upload clipboard images', {
            imageCount: uploadableImages.length,
            error: (error as Error)?.message ?? 'unknown',
          });
          notificationService.error('Image upload failed. Please try again.', { duration: 3000 });
          throw error;
        }
      }

      let fullMessage = trimmedMessage;
      const sendCapturedAt = Date.now();
      let composerSubmission = options?.composerSubmission;
      if (ambientFocus && composerSubmission) {
        const alreadyIncluded = composerSubmission.attachments.some(
          attachment => attachment.id === ambientFocus.id,
        );
        if (!alreadyIncluded) {
          const nextOrdinal = composerSubmission.attachments.reduce(
            (largest, attachment) => Math.max(largest, attachment.ordinal),
            0,
          ) + 1;
          composerSubmission = {
            ...composerSubmission,
            attachments: [
              ...composerSubmission.attachments,
              {
                id: ambientFocus.id,
                ordinal: nextOrdinal,
                type: ambientFocus.type,
                title: `${ambientFocus.sheetName}!${ambientFocus.a1}`,
                modelContent: formatSpreadsheetFocusContext(ambientFocus, sendCapturedAt),
              },
            ],
          };
        }
      } else if (ambientFocus) {
        fullMessage = [trimmedMessage, formatSpreadsheetFocusContext(ambientFocus, sendCapturedAt)]
          .filter(Boolean)
          .join('\n\n');
      }

      const displayMessage = options?.displayMessage?.trim()
        || trimmedMessage
        || composerSubmission?.attachments
          .map(attachment => `[Attachment ${attachment.ordinal}: ${attachment.title}]`)
          .join(' ')
        || '';

      // Always pass imageContexts to the backend; the coordinator decides
      // whether to pre-analyse via a vision model or attach directly.
      const imageContextsForBackend = imageContexts.length > 0
        ? {
            imageContexts: resolvedImageContexts.map(({ context, imagePath }) => ({
              id: context.id,
              image_path: imagePath,
              data_url: undefined,
              mime_type: context.mimeType,
              metadata: {
                name: context.imageName,
                width: context.width,
                height: context.height,
                file_size: context.fileSize,
                source: context.source,
                attachment_number: composerSubmission?.attachments.find(
                  attachment => attachment.id === context.id,
                )?.ordinal,
              },
            })),
            imageDisplayData: resolvedImageContexts.map(({ context, imagePath, dataUrl }) => ({
              id: context.id,
              name: context.imageName || 'Image',
              dataUrl,
              imagePath,
              mimeType: context.mimeType,
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
      const baseMessageMetadata = spreadsheetFocusMessageMetadata
        ? {
            ...(options?.metadata ?? {}),
            spreadsheetFocus: spreadsheetFocusMessageMetadata,
          }
        : options?.metadata;
      const resolvedSendContext = await resolveSendContext?.({
        message: trimmedMessage || displayMessage,
        sessionId,
      });
      const messageMetadata = resolvedSendContext?.metadata
        ? {
            ...(baseMessageMetadata ?? {}),
            ...resolvedSendContext.metadata,
          }
        : baseMessageMetadata;

      await flowChatManager.sendMessage(
        fullMessage,
        sessionId || undefined,
        displayMessage,
        undefined,
        undefined,
        {
          ...imageContextsForBackend,
          metadata: messageMetadata,
          triggerSource: resolvedSendContext?.triggerSource ?? options?.triggerSource,
          systemReminderOverride:
            resolvedSendContext?.systemReminderOverride ?? options?.systemReminderOverride,
          localDialogTurnId: options?.localDialogTurnId,
          composerSubmission,
        }
      );

      onExitTemplateMode?.();

      onSuccess?.(displayMessage);
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
  }, [
    currentSessionId,
    contexts,
    onSuccess,
    onExitTemplateMode,
    currentAgentType,
    resolveSendContext,
  ]);

  return {
    sendMessage,
    isSending: false,
  };
}
