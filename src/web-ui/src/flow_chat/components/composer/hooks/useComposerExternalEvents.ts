import { useCallback, useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { ContextItem, ImageContext } from '@/shared/types/context';
import type {
  ComposerContextSnapshot,
} from '@/shared/types/composer';
import type {
  AttachmentReferenceResolution,
  AttachmentResolution,
  AttachmentResolveOptions,
} from '@/shared/stores/contextStore';
import { parseComposerContextSnapshot } from '@/shared/types/composer';
import { globalEventBus } from '@/infrastructure/event-bus';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import type {
  McpAppMessageEvent,
  McpAppMessageResponseEvent,
} from '@/infrastructure/api/service-api/MCPAPI';
import { CHAT_INPUT_CONFIG } from '../../../constants/chatInputConfig';
import { createImageContextFromClipboard } from '../../../utils/imageUtils';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { ChatInputTarget } from '../model/composerState';

const log = createLogger('ComposerExternalEvents');

type ChatInputEventTarget = ChatInputTarget;

interface UseComposerExternalEventsParams {
  editorRef: RefObject<RichTextInputHandle | null>;
  inputValue: string;
  inputValueRef: MutableRefObject<string>;
  isActive: boolean;
  activateInput: () => void;
  setInputValue: (value: string) => void;
  setInputTarget: (target: ChatInputTarget) => void;
  resolveAttachment: (
    context: ContextItem,
    options?: AttachmentResolveOptions,
  ) => AttachmentResolution;
  resolveAttachmentReference: (
    context: ContextItem,
    options?: AttachmentResolveOptions,
  ) => AttachmentReferenceResolution;
  restoreComposerSnapshot: (snapshot: ComposerContextSnapshot) => void;
  enabled?: boolean;
  allowContextInput?: boolean;
  targetSessionId?: string | null;
  t: TFunction<'flow-chat'>;
}

export function useComposerExternalEvents({
  editorRef,
  inputValue,
  inputValueRef,
  isActive,
  activateInput,
  setInputValue,
  setInputTarget,
  resolveAttachment,
  resolveAttachmentReference,
  restoreComposerSnapshot,
  enabled = true,
  allowContextInput = true,
  targetSessionId,
  t,
}: UseComposerExternalEventsParams) {
  const applyRequestedTarget = useCallback((target?: ChatInputEventTarget) => {
    if (!target) return;
    setInputTarget(target);
  }, [setInputTarget]);

  useEffect(() => {
    if (!enabled) return;
    const handleFillInput = (event: Event) => {
      const customEvent = event as CustomEvent<{
        message: string;
        sessionId?: string;
        target?: ChatInputEventTarget;
        composerContext?: unknown;
        onlyIfEmpty?: boolean;
      }>;
      const message = customEvent.detail?.message;

      if (message) {
        if (
          customEvent.detail?.sessionId
          && customEvent.detail.sessionId !== targetSessionId
        ) {
          return;
        }
        if (customEvent.detail?.onlyIfEmpty && inputValueRef.current.trim()) return;
        applyRequestedTarget(customEvent.detail?.target);
        const snapshot = customEvent.detail?.composerContext;
        const parsedSnapshot = parseComposerContextSnapshot(snapshot);
        if (parsedSnapshot) restoreComposerSnapshot(parsedSnapshot);
        else {
          activateInput();
          setInputValue(message);
        }
        editorRef.current?.focus();
      }
    };

    window.addEventListener('fill-chat-input', handleFillInput);
    return () => {
      window.removeEventListener('fill-chat-input', handleFillInput);
    };
  }, [
    activateInput,
    applyRequestedTarget,
    editorRef,
    enabled,
    inputValueRef,
    restoreComposerSnapshot,
    setInputValue,
    targetSessionId,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const handleAppendInput = (event: Event) => {
      const customEvent = event as CustomEvent<{ text: string; target?: ChatInputEventTarget }>;
      const text = customEvent.detail?.text?.trim();

      if (!text) {
        return;
      }

      applyRequestedTarget(customEvent.detail?.target);
      const currentValue = inputValueRef.current;
      activateInput();
      if (currentValue.trim().length > 0 && editorRef.current) {
        editorRef.current.focus();
        editorRef.current.insertText(`\n\n${text}`);
      } else {
        setInputValue(text);
        editorRef.current?.focus();
      }
    };

    window.addEventListener('append-chat-input', handleAppendInput);
    return () => {
      window.removeEventListener('append-chat-input', handleAppendInput);
    };
  }, [activateInput, applyRequestedTarget, editorRef, enabled, inputValueRef, setInputValue]);

  useEffect(() => {
    if (!enabled) return;
    const handleFillChatInput = (data: { content: string; onlyIfEmpty?: boolean }) => {
      if (data.onlyIfEmpty && inputValueRef.current.trim().length > 0) {
        return;
      }
      activateInput();
      setInputValue(data.content);
      editorRef.current?.focus();
    };

    globalEventBus.on('fill-chat-input', handleFillChatInput);
    return () => {
      globalEventBus.off('fill-chat-input', handleFillChatInput);
    };
  }, [activateInput, editorRef, enabled, inputValueRef, setInputValue]);

  useEffect(() => {
    if (!enabled || !allowContextInput) return;
    const handleMcpAppMessage = async (event: McpAppMessageEvent) => {
      const { requestId, params } = event;

      if (inputValue.trim()) {
        log.warn('MCP App ui/message rejected: input already has content');
        globalEventBus.emit('mcp-app:message-response', {
          requestId,
          result: { isError: true },
        } as McpAppMessageResponseEvent);
        return;
      }

      try {
        const textContent = params.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n\n');

        if (textContent) {
          activateInput();
          setInputValue(textContent);
        }

        let rejectedByLimit = false;
        for (const block of params.content) {
          if (block.type === 'image') {
            try {
              const mimeType = block.mimeType || 'image/png';
              const binaryString = atob(block.data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: mimeType });
              const file = new File([blob], `image.${mimeType.split('/')[1] || 'png'}`, { type: mimeType });
              const imageContext = await createImageContextFromClipboard(file);
              const resolution = resolveAttachment(imageContext, {
                maxAssetsOfType: CHAT_INPUT_CONFIG.image.maxCount,
              });
              if (resolution.kind === 'rejected') rejectedByLimit = true;
            } catch (err) {
              log.error('Failed to add image from MCP App message', { err });
            }
          }
        }
        if (rejectedByLimit) {
          notificationService.warning(
            t('input.maxImagesWarning', { count: CHAT_INPUT_CONFIG.image.maxCount }),
            { duration: 3000 },
          );
        }

        editorRef.current?.focus();
        globalEventBus.emit('mcp-app:message-response', {
          requestId,
          result: { isError: false },
        } as McpAppMessageResponseEvent);
      } catch (err) {
        log.error('Failed to handle MCP App ui/message', { err });
        globalEventBus.emit('mcp-app:message-response', {
          requestId,
          result: { isError: true },
        } as McpAppMessageResponseEvent);
      }
    };

    globalEventBus.on('mcp-app:message', handleMcpAppMessage);
    return () => {
      globalEventBus.off('mcp-app:message', handleMcpAppMessage);
    };
  }, [
    activateInput,
    resolveAttachment,
    allowContextInput,
    editorRef,
    enabled,
    inputValue,
    setInputValue,
    t,
  ]);

  useEffect(() => {
    if (!enabled || !allowContextInput) return;
    const handleInsertContextTag = (event: Event) => {
      const customEvent = event as CustomEvent<{ context: ContextItem }>;
      const context = customEvent.detail?.context;

      if (context) {
        const resolution = resolveAttachmentReference(context);
        if (resolution.kind === 'rejected') return;
        if (!isActive) {
          activateInput();
        }

        setTimeout(() => {
          editorRef.current?.focus();
          editorRef.current?.insertTag(resolution.reference, resolution.asset);
        }, 50);
      }
    };

    window.addEventListener('insert-context-tag', handleInsertContextTag);
    return () => {
      window.removeEventListener('insert-context-tag', handleInsertContextTag);
    };
  }, [activateInput, allowContextInput, editorRef, enabled, isActive, resolveAttachmentReference]);

  useEffect(() => {
    if (!enabled || !allowContextInput) return;
    const handleImagePaste = async (event: Event) => {
      const customEvent = event as CustomEvent<{ file: File }>;
      const file = customEvent.detail?.file;

      if (!file) return;

      try {
        const imageContext: ImageContext = await createImageContextFromClipboard(file);
        const resolution = resolveAttachmentReference(imageContext, {
          maxAssetsOfType: CHAT_INPUT_CONFIG.image.maxCount,
        });
        if (resolution.kind === 'rejected') {
          notificationService.warning(
            t('input.maxImagesWarning', { count: CHAT_INPUT_CONFIG.image.maxCount }),
            { duration: 3000 },
          );
          return;
        }

        if (!isActive) {
          activateInput();
        }
        editorRef.current?.insertTag(resolution.reference, resolution.asset);
      } catch (error) {
        log.error('Failed to process clipboard image', { fileName: file.name, error });
        notificationService.error(
          `${t('input.imagePasteFailed')}: ${error instanceof Error ? error.message : t('error.unknown')}`,
          { duration: 3000 }
        );
      }
    };

    let inputElement: HTMLDivElement | null = null;
    let attachFrame: number | null = null;
    let disposed = false;
    const attachToEditor = () => {
      if (disposed) return;
      inputElement = editorRef.current?.element ?? null;
      if (!inputElement) {
        attachFrame = requestAnimationFrame(attachToEditor);
        return;
      }
      inputElement.addEventListener('imagePaste', handleImagePaste);
    };
    attachToEditor();

    return () => {
      disposed = true;
      if (attachFrame != null) cancelAnimationFrame(attachFrame);
      if (inputElement) {
        inputElement.removeEventListener('imagePaste', handleImagePaste);
      }
    };
  }, [
    activateInput,
    resolveAttachmentReference,
    allowContextInput,
    editorRef,
    enabled,
    isActive,
    t,
  ]);
}
