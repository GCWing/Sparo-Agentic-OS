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
  SpreadsheetFocusCacheCoverage,
  SpreadsheetFocusContext,
} from '@/shared/types/context';
import type { TriggerSource } from '@/shared/types/session-history';
import type { AIModelConfig, DefaultModelsConfig } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';
import { descriptorFromAgentType } from '../domain/sessionDescriptor';
import {
  isSpreadsheetFocusBoundToSession,
  spreadsheetFormulaResultsTrustworthy,
  spreadsheetFocusMetadata,
  useExcelLiveFocusStore,
} from '@/app/agentic-os/excel-live/excelLiveFocusStore';

const log = createLogger('FlowChat');

function formatSpreadsheetCacheCoverage(
  coverage: SpreadsheetFocusCacheCoverage | undefined,
): string {
  if (coverage == null) return 'unknown';
  if (typeof coverage === 'number') {
    if (coverage >= 0 && coverage <= 1) return `${Math.round(coverage * 100)}%`;
    return String(coverage);
  }

  const cached = coverage.cachedCellCount ?? coverage.loadedCellCount;
  const selected = coverage.selectedCellCount ?? coverage.totalCellCount;
  if (typeof cached === 'number' && typeof selected === 'number') {
    return `${cached}/${selected} cells`;
  }
  if (typeof coverage.ratio === 'number') {
    return `${Math.round(coverage.ratio * 100)}%`;
  }
  return JSON.stringify(coverage);
}

function formatSpreadsheetFreshness(capturedAt: number, sendCapturedAt: number): string {
  const hasCapturedAt = Number.isFinite(capturedAt) && capturedAt > 0;
  const safeCapturedAt = hasCapturedAt ? capturedAt : sendCapturedAt;
  const capturedIso = hasCapturedAt ? new Date(safeCapturedAt).toISOString() : 'unknown';
  const ageMs = Math.max(0, sendCapturedAt - safeCapturedAt);
  return `${capturedIso}; age at send ${ageMs} ms`;
}

export function formatSpreadsheetFocusContext(
  context: SpreadsheetFocusContext,
  sendCapturedAt: number,
): string {
  const formulaTrustworthy = spreadsheetFormulaResultsTrustworthy(context);
  const lines = [
    `[Spreadsheet Focus (${context.role}): ${context.sheetName}!${context.a1}]`,
    `Binding: session=${context.sessionId || 'unbound'}; workbook=${context.workbookId}${context.workbookPath ? ` (${context.workbookPath})` : ''}`,
    `Selection: ${context.selectionKind}; size=${context.rowCount}x${context.columnCount}`,
    `Mode: ${context.mode || 'unknown'}`,
    `Revision: ${context.revision ?? 'unknown'}`,
    `Cache: ${context.cacheComplete ? 'complete' : 'incomplete'}; coverage=${formatSpreadsheetCacheCoverage(context.cacheCoverage)}`,
    `Formula results: ${formulaTrustworthy ? (context.formulaResultsFresh === true ? 'fresh' : 'no untrusted formula evidence') : 'stale/unknown and untrusted'}; calculationStatus=${JSON.stringify(context.calculationStatus ?? null)}`,
    `Fidelity: ${JSON.stringify(context.fidelity ?? null)}`,
    `Freshness: ${formatSpreadsheetFreshness(context.capturedAt, sendCapturedAt)}`,
  ];

  if (context.valueSummary) {
    lines.push(
      `${context.cacheComplete ? 'Value summary' : 'Cached value summary (partial, not authoritative)'}: ${JSON.stringify(context.valueSummary)}`,
    );
  }

  // Defense in depth: the store already strips previews that lack complete
  // cache evidence, but persisted contexts may predate that rule.
  if (!formulaTrustworthy) {
    lines.push('Preview TSV: omitted because formula results are stale, cached, or not explicitly proven fresh. Inspect formulas, but require recalculation before trusting their numeric results.');
  } else if (context.cacheComplete && context.previewTsv) {
    lines.push(
      context.previewTruncated
        ? `Preview TSV (truncated):\n\`\`\`tsv\n${context.previewTsv}\n\`\`\``
        : `Preview TSV:\n\`\`\`tsv\n${context.previewTsv}\n\`\`\``,
    );
  } else if (!context.cacheComplete) {
    lines.push('Preview TSV: omitted because the selection cache is incomplete. Read the range before relying on cell values.');
  } else {
    lines.push('Preview TSV: unavailable for this captured focus. Use read_range / summarize_range when values are needed.');
  }

  return lines.join('\n');
}

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
  /** Clear contexts callback */
  onClearContexts: () => void;
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
    onClearContexts,
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
    // Strip inline `#img:<name>` tags from the AI-bound text. The rich text
    // editor inserts these when an image is pasted, but the named file does
    // not exist on disk; image bytes are sent out-of-band via `imageContexts`
    // below. Leaving the placeholder in the prompt misleads the model into
    // looking up a non-existent file. The display message keeps the tag so
    // the UI can still render the inline pill.
    const stripOutOfBandContextTags = (text: string): string =>
      text
        .replace(/#img:[^\s\n]+\s?/g, '')
        .replace(/#sheet:[^\s\n]+\s?/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const aiTrimmedMessage = stripOutOfBandContextTags(trimmedMessage);
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

      let fullMessage = aiTrimmedMessage;
      const displayMessage = options?.displayMessage?.trim() || trimmedMessage;
      const sendCapturedAt = Date.now();

      if (mergedContexts.length > 0) {
        const fullContextSection = mergedContexts.map(ctx => {
          switch (ctx.type) {
            case 'file':
              return `[File: ${ctx.relativePath || ctx.filePath}]`;
            case 'directory':
              return `[Directory: ${ctx.directoryPath}]`;
            case 'code-snippet':
              return `[Code Snippet: ${ctx.filePath}:${ctx.startLine}-${ctx.endLine}]`;
            case 'image':
              // Images are sent out-of-band via `imageContexts` so the backend can attach them
              // for multimodal models or convert to text placeholders for text-only models. Avoid embedding
              // "Image ID" references into the user prompt, which can cause redundant tool calls.
              return '';
            case 'terminal-command':
              return `[Command: ${ctx.command}]`;
            case 'git-ref':
              return `[Git Ref: ${ctx.refValue}]`;
            case 'url':
              return `[URL: ${ctx.url}]`;
            case 'web-element': {
              const attrStr = Object.entries(ctx.attributes)
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ');
              const lines = [
                `[Web Element: <${ctx.tagName}${attrStr ? ' ' + attrStr : ''}>]`,
                `CSS Path: ${ctx.path}`,
              ];
              if (ctx.sourceUrl) lines.push(`Source URL: ${ctx.sourceUrl}`);
              if (ctx.textContent) lines.push(`Text Content: ${ctx.textContent}`);
              if (ctx.outerHTML) lines.push(`Outer HTML:\n\`\`\`html\n${ctx.outerHTML}\n\`\`\``);
              return lines.join('\n');
            }
            case 'product-app-preview-element-selection': {
              const lines = [
                `[Product App Preview Element: ${ctx.appName || ctx.appId} @ ${ctx.route}]`,
                `Selector: ${ctx.element.selectorPath}`,
                `Confidence: ${ctx.confidence}`,
                `Fingerprint: ${JSON.stringify(ctx.fingerprint)}`,
              ];
              lines.push(`Element Summary:\n\`\`\`json\n${JSON.stringify(ctx.element, null, 2)}\n\`\`\``);
              return lines.join('\n');
            }
            case 'spreadsheet-focus':
              return formatSpreadsheetFocusContext(ctx, sendCapturedAt);
            default:
              return '';
          }
        }).filter(Boolean).join('\n');

        fullMessage = `${fullContextSection}\n\n${aiTrimmedMessage}`;
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

      onClearContexts();

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
  }, [currentSessionId, contexts, onClearContexts, onSuccess, onExitTemplateMode, currentAgentType]);

  return {
    sendMessage,
    isSending: false,
  };
}
