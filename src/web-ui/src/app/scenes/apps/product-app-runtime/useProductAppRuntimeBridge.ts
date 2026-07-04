/**
 * useProductAppRuntimeBridge handles postMessage JSON-RPC from the Product App iframe:
 * worker.call to JS Worker, fs/shell/os/net to host primitives,
 * dialog.open/save/message to Tauri dialog, ai.* to host AI client,
 * clipboard.* to host navigator.clipboard.
 * Also handles sparo/request-theme and pushes theme changes to the iframe.
 */
import { useLayoutEffect, useRef, useEffect, RefObject } from 'react';
import { productAppRuntimeHostAPI } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import { open as dialogOpen, save as dialogSave, message as dialogMessage } from '@tauri-apps/plugin-dialog';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { buildProductAppRuntimeThemeVars } from './productAppRuntimeThemeVars';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { descriptorFromAgentType } from '@/flow_chat/domain/sessionDescriptor';
import { useProductAppRuntimeStore } from './productAppRuntimeStore';
import type { ProductAppHostSurface } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import {
  normalizeAppScope,
  type AppScope,
  workspacePathFromAppScope,
} from '@/shared/types/app-scope';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';

interface JSONRPC {
  jsonrpc?: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface AiStreamPayload {
  appId: string;
  runtimeOwnerId: string;
  streamId: string;
  type: 'chunk' | 'done' | 'error';
  data: Record<string, unknown>;
}

interface AgenticEventPayload {
  sessionId?: string;
  turnId?: string;
  [key: string]: unknown;
}

interface RuntimeIssuePayload {
  appId?: string;
  severity?: 'fatal' | 'warning' | 'noise';
  message?: string;
  source?: string;
  stack?: string;
  category?: string;
  timestampMs?: number;
}

interface RuntimeLogPayload {
  appId?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  category?: string;
  message?: string;
  source?: string;
  stack?: string;
  details?: unknown;
  timestampMs?: number;
}

interface ProductAppRuntimeBridgeOptions {
  scope?: AppScope | null;
  runtimeContext?: ProductAppRuntimeContext | null;
}

const NOOP_BRIDGE_METHODS = new Set([
  // Emitted by the injected scroll-boundary script when iframe scrolling reaches an edge.
  'sparo/sandbox-wheel',
  // Fire-and-forget bridge readiness handshake consumed by the Product App runtime host adapter.
  'sparo/runtime-ready',
  // Fire-and-forget safe interaction probe consumed by the Product App runtime host adapter.
  'sparo/interaction-probe',
  // Fire-and-forget user path rehearsal result consumed by the Product App runtime host adapter.
  'sparo/user-path-rehearsal',
]);

const HOST_PRIMITIVE_NAMESPACES = new Set(['fs', 'shell', 'os', 'net']);

function isHostPrimitive(method: string): boolean {
  const [namespace] = method.split('.', 1);
  return HOST_PRIMITIVE_NAMESPACES.has(namespace);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function productAppRuntimeOwnerId(context: ProductAppRuntimeContext): string {
  return `product-app-runtime:${context.workId}:${context.runtimeInstanceId}`;
}

export function useProductAppRuntimeBridge(
  iframeRef: RefObject<HTMLIFrameElement>,
  app: ProductAppHostSurface,
  options: ProductAppRuntimeBridgeOptions = {},
) {
  const { theme: currentTheme } = useTheme();
  const { currentLanguage } = useI18n();
  const themeRef = useRef(currentTheme);
  themeRef.current = currentTheme;
  const localeRef = useRef(currentLanguage);
  localeRef.current = currentLanguage;
  const workspacePathRef = useRef(workspacePathFromAppScope(options.scope));
  workspacePathRef.current = workspacePathFromAppScope(normalizeAppScope(options.scope));
  const runtimeContextRef = useRef<ProductAppRuntimeContext | null>(options.runtimeContext ?? null);
  runtimeContextRef.current = options.runtimeContext ?? null;
  const agenticSessionIdsRef = useRef<Set<string>>(new Set());

  const appIdRef = useRef(app.id);
  useLayoutEffect(() => {
    appIdRef.current = app.id;
  }, [app.id]);

  useLayoutEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const msg = event.data as JSONRPC & { method?: string };
      if (!msg?.method) return;

      const { id, method, params = {} } = msg;
      const appId = appIdRef.current;
      const requireRuntimeContext = () => {
        const runtimeContext = runtimeContextRef.current;
        if (!runtimeContext) {
          throw new Error('runtimeContext is required for Product App runtime operations');
        }
        return runtimeContext;
      };
      const reply = (result: unknown) =>
        iframeRef.current?.contentWindow?.postMessage({ jsonrpc: '2.0', id, result }, '*');
      const replyError = (message: string) =>
        iframeRef.current?.contentWindow?.postMessage(
          { jsonrpc: '2.0', id, error: { code: -32000, message } },
          '*',
        );

      if (method === 'sparo/request-theme') {
        const payload = buildProductAppRuntimeThemeVars(themeRef.current);
        if (payload && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: 'sparo:event', event: 'themeChange', payload },
            '*',
          );
        }
        return;
      }

      if (method === 'sparo/request-locale') {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: 'sparo:event', event: 'localeChange', payload: { locale: localeRef.current } },
            '*',
          );
        }
        return;
      }

      if (method === 'sparo/runtime-error') {
        const issue = params as RuntimeIssuePayload;
        const runtimeContext = runtimeContextRef.current;
        if (!runtimeContext) {
          replyError('runtimeContext is required for Product App runtime operations');
          return;
        }
        void productAppRuntimeHostAPI.reportRuntimeIssue({
          appId,
          runtimeContext,
          severity: issue.severity ?? 'fatal',
          message: issue.message ?? 'Unknown runtime error',
          source: issue.source,
          stack: issue.stack,
          category: issue.category ?? 'runtime',
          timestampMs: issue.timestampMs ?? Date.now(),
        }).catch(() => undefined);
        return;
      }

      if (method === 'sparo/runtime-log') {
        const logEntry = params as RuntimeLogPayload;
        const runtimeContext = runtimeContextRef.current;
        if (!runtimeContext) {
          replyError('runtimeContext is required for Product App runtime operations');
          return;
        }
        if (logEntry.message) {
          void productAppRuntimeHostAPI.reportRuntimeLog({
            appId,
            runtimeContext,
            level: logEntry.level ?? 'info',
            category: logEntry.category ?? 'runtime',
            message: logEntry.message,
            source: logEntry.source,
            stack: logEntry.stack,
            details: logEntry.details,
            timestampMs: logEntry.timestampMs ?? Date.now(),
          }).catch(() => undefined);
        }
        return;
      }

      if (NOOP_BRIDGE_METHODS.has(method)) {
        return;
      }

      try {
        if (isHostPrimitive(method)) {
          const result = await productAppRuntimeHostAPI.workerCall(
            appId,
            method,
            params,
            requireRuntimeContext(),
            workspacePathRef.current || undefined,
          );
          reply(result);
          return;
        }
        if (method === 'sparo.deck.renderPage') {
          const result = await productAppRuntimeHostAPI.renderSlidePage({
            html: String((params as { html?: string }).html ?? ''),
            format: String((params as { format?: string }).format ?? 'png'),
            width: (params as { width?: number }).width,
            height: (params as { height?: number }).height,
          });
          reply(result);
          return;
        }
        if (method === 'worker.call') {
          useProductAppRuntimeStore.getState().markWorkerRunning(appId);
          const result = await productAppRuntimeHostAPI.workerCall(
            appId,
            (params.method as string) ?? '',
            (params.params as Record<string, unknown>) ?? {},
            requireRuntimeContext(),
            workspacePathRef.current || undefined,
          );
          reply(result);
          return;
        }
        if (method === 'dialog.open') {
          reply(await dialogOpen(params as unknown as Parameters<typeof dialogOpen>[0]));
          return;
        }
        if (method === 'dialog.save') {
          reply(await dialogSave(params as unknown as Parameters<typeof dialogSave>[0]));
          return;
        }
        if (method === 'dialog.message') {
          reply(await dialogMessage(params as unknown as Parameters<typeof dialogMessage>[0]));
          return;
        }

        if (method === 'ai.complete') {
          const result = await productAppRuntimeHostAPI.aiComplete(
            appId,
            (params.prompt as string) ?? '',
            requireRuntimeContext(),
            {
              systemPrompt: params.systemPrompt as string | undefined,
              model: params.model as string | undefined,
              maxTokens: params.maxTokens as number | undefined,
              temperature: params.temperature as number | undefined,
            },
          );
          reply(result);
          return;
        }
        if (method === 'ai.chat') {
          const result = await productAppRuntimeHostAPI.aiChat(
            appId,
            (params.messages as { role: 'user' | 'assistant'; content: string }[]) ?? [],
            (params.streamId as string) ?? '',
            requireRuntimeContext(),
            {
              systemPrompt: params.systemPrompt as string | undefined,
              model: params.model as string | undefined,
              maxTokens: params.maxTokens as number | undefined,
              temperature: params.temperature as number | undefined,
            },
          );
          reply(result);
          return;
        }
        if (method === 'ai.cancel') {
          await productAppRuntimeHostAPI.aiCancel(appId, (params.streamId as string) ?? '', requireRuntimeContext());
          reply(null);
          return;
        }
        if (method === 'ai.getModels') {
          const models = await productAppRuntimeHostAPI.aiListModels(appId, requireRuntimeContext());
          reply(models);
          return;
        }

        if (method === 'backend.call') {
          const result = await productAppRuntimeHostAPI.backendCall(
            appId,
            (params.target as string) ?? '',
            params.input,
            {
              runtimeContext: requireRuntimeContext(),
              entityId: params.entityId as string | undefined,
              idempotencyKey: params.idempotencyKey as string | undefined,
              workspacePath: workspacePathRef.current || undefined,
            },
          );
          const isPrivatePptLiveRun = appId === 'builtin-ppt-live' && result.backendId === 'ppt';
          if (result.backendKind === 'agentComponent' && result.sessionId) {
            // Private PPT Live runs must still receive agentic stream events in the iframe,
            // but should not appear as external Flow Chat sessions.
            agenticSessionIdsRef.current.add(result.sessionId);
            if (!isPrivatePptLiveRun) {
              flowChatStore.addExternalSession(
                result.sessionId,
                `${result.backendId}.${result.action}`,
                descriptorFromAgentType(result.agentType),
                undefined,
              );
            }
          }
          reply(result);
          return;
        }
        if (method === 'backend.cancel') {
          const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
          const turnId = typeof params.turnId === 'string' ? params.turnId : '';
          if (!sessionId || !turnId) {
            replyError('backend.cancel requires sessionId and turnId');
            return;
          }
          await api.invoke('cancel_dialog_turn', {
            request: { sessionId, dialogTurnId: turnId },
          });
          reply(null);
          return;
        }
        if (method === 'backend.status') {
          const actionRunId = typeof params.actionRunId === 'string' ? params.actionRunId : '';
          if (!actionRunId) {
            replyError('backend.status requires actionRunId');
            return;
          }
          const result = await productAppRuntimeHostAPI.backendStatus(appId, actionRunId, {
            runtimeContext: requireRuntimeContext(),
            sessionId: params.sessionId as string | undefined,
            turnId: params.turnId as string | undefined,
          });
          reply(result);
          return;
        }
        if (method === 'backend.cancelRun') {
          const actionRunId = typeof params.actionRunId === 'string' ? params.actionRunId : '';
          if (!actionRunId) {
            replyError('backend.cancelRun requires actionRunId');
            return;
          }
          const result = await productAppRuntimeHostAPI.backendCancelRun(appId, actionRunId, {
            runtimeContext: requireRuntimeContext(),
            sessionId: params.sessionId as string | undefined,
            turnId: params.turnId as string | undefined,
          });
          reply(result);
          return;
        }
        if (method === 'backend.cancelStaleRuns') {
          const result = await productAppRuntimeHostAPI.cancelStalePptRuns(
            workspacePathRef.current || undefined,
          );
          agenticSessionIdsRef.current.clear();
          reply(result);
          return;
        }
        if (method === 'backend.turnText') {
          const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
          const turnId = typeof params.turnId === 'string' ? params.turnId : '';
          if (!sessionId || !turnId) {
            replyError('backend.turnText requires sessionId and turnId');
            return;
          }
          const result = await productAppRuntimeHostAPI.getPptTurnAssistantText(
            sessionId,
            turnId,
            workspacePathRef.current || undefined,
          );
          reply(result);
          return;
        }

        if (method === 'clipboard.writeText') {
          await navigator.clipboard.writeText((params.text as string) ?? '');
          reply(null);
          return;
        }
        if (method === 'clipboard.readText') {
          const text = await navigator.clipboard.readText();
          reply(text);
          return;
        }

        if (method === 'host.fillChatInput') {
          const text = typeof params.text === 'string' ? params.text : '';
          window.dispatchEvent(new CustomEvent('fill-chat-input', { detail: { message: text } }));
          reply(null);
          return;
        }

        const message = `Unknown method: ${method}`;
        replyError(message);
      } catch (error) {
        const message = `Bridge call failed: ${method}: ${errorMessage(error)}`;
        replyError(message);
      }
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, [iframeRef]);

  useEffect(() => {
    const payload = buildProductAppRuntimeThemeVars(currentTheme);
    if (!payload || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'sparo:event', event: 'themeChange', payload },
      '*',
    );
  }, [currentTheme, iframeRef]);

  useEffect(() => {
    if (!currentLanguage || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'sparo:event', event: 'localeChange', payload: { locale: currentLanguage } },
      '*',
    );
  }, [currentLanguage, iframeRef]);

  useEffect(() => {
    const currentAppId = app.id;
    const currentRuntimeContext = runtimeContextRef.current;
    if (!currentRuntimeContext) return undefined;
    const currentRuntimeOwnerId = productAppRuntimeOwnerId(currentRuntimeContext);
    const unlisten = api.listen<AiStreamPayload>('product-app-runtime://ai-stream', (payload) => {
      if (!iframeRef.current?.contentWindow) return;
      if (payload.appId !== currentAppId) return;
      if (payload.runtimeOwnerId !== currentRuntimeOwnerId) return;
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'sparo:event',
          event: 'ai:stream',
          payload: {
            streamId: payload.streamId,
            type: payload.type,
            data: payload.data,
          },
        },
        '*',
      );
    });

    return () => {
      unlisten();
    };
  }, [app.id, iframeRef, options.runtimeContext]);

  useEffect(() => {
    const currentRuntimeContext = runtimeContextRef.current;
    if (!currentRuntimeContext) return undefined;
    const currentRuntimeOwnerId = productAppRuntimeOwnerId(currentRuntimeContext);
    const eventName = `product-app-runtime://worker-event:${currentRuntimeOwnerId}`;
    const unlisten = api.listen<{ appId: string; event: string; data: unknown }>(
      eventName,
      (payload) => {
        if (payload.appId !== currentRuntimeOwnerId) return;
        if (!iframeRef.current?.contentWindow) return;
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'sparo:event',
            event: 'worker:event',
            payload: {
              event: payload.event,
              data: payload.data,
            },
          },
          '*',
        );
      },
    );

    return () => {
      unlisten();
    };
  }, [iframeRef, options.runtimeContext]);

  useEffect(() => {
    const currentAppId = app.id;
    const currentRuntimeContext = runtimeContextRef.current;
    const currentRuntimeOwnerId = currentRuntimeContext
      ? productAppRuntimeOwnerId(currentRuntimeContext)
      : null;
    const unlisten = api.listen<{
      appId: string;
      runtimeOwnerId?: string;
      backendId: string;
      action: string;
      actionRunId: string;
      backendKind: string;
      backendComponentId: string;
      event: unknown;
    }>('product-app-runtime-backend-event', (payload) => {
      if (payload.appId !== currentAppId) return;
      if (!currentRuntimeOwnerId || payload.runtimeOwnerId !== currentRuntimeOwnerId) return;
      if (!iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'sparo:event',
          event: 'backend:event',
          payload: {
            sourceEvent: 'product-app-runtime-backend-event',
            ...payload,
          },
        },
        '*',
      );
    });

    return () => {
      unlisten();
    };
  }, [app.id, iframeRef, options.runtimeContext]);

  useEffect(() => {
    const eventNames = [
      'agentic://session-created',
      'agentic://session-state-changed',
      'agentic://dialog-turn-started',
      'agentic://model-round-started',
      'agentic://model-round-completed',
      'agentic://text-chunk',
      'agentic://tool-event',
      'agentic://dialog-turn-completed',
      'agentic://dialog-turn-failed',
      'agentic://dialog-turn-cancelled',
      'agentic://token-usage-updated',
      'agentic://context-compression-started',
      'agentic://context-compression-completed',
      'agentic://context-compression-failed',
    ];

    const unlisteners = eventNames.map((eventName) =>
      api.listen<AgenticEventPayload>(eventName, (payload) => {
        const sessionId = payload.sessionId;
        if (!sessionId || !agenticSessionIdsRef.current.has(sessionId)) return;
        if (!iframeRef.current?.contentWindow) return;
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'sparo:event',
            event: 'backend:event',
            payload: {
              sourceEvent: eventName,
              ...payload,
            },
          },
          '*',
        );
      }),
    );

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [iframeRef]);
}
