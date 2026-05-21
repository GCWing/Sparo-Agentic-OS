/**
 * useLiveAppBridge �?handles postMessage JSON-RPC from the Live App iframe:
 * worker.call �?JS Worker, fs/shell/os/net �?host primitives, dialog.open/save/message �?Tauri dialog,
 * ai.* �?Host AI client, clipboard.* �?Host navigator.clipboard.
 * Also handles sparo/request-theme and pushes theme changes to the iframe.
 */
import { useLayoutEffect, useRef, useEffect, RefObject } from 'react';
import { liveAppAPI } from '@/infrastructure/api/service-api/LiveAppAPI';
import { open as dialogOpen, save as dialogSave, message as dialogMessage } from '@tauri-apps/plugin-dialog';
import type { LiveApp } from '@/infrastructure/api/service-api/LiveAppAPI';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useTheme } from '@/infrastructure/theme/hooks/useTheme';
import { useI18n } from '@/infrastructure/i18n';
import { buildLiveAppThemeVars } from '../buildLiveAppThemeVars';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { useLiveAppStore } from '../liveAppStore';

interface JSONRPC {
  jsonrpc?: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface AiStreamPayload {
  appId: string;
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

const NOOP_BRIDGE_METHODS = new Set([
  // Emitted by the injected scroll-boundary script when iframe scrolling reaches an edge.
  'sparo/sandbox-wheel',
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

export function useLiveAppBridge(
  iframeRef: RefObject<HTMLIFrameElement>,
  app: LiveApp,
) {
  const { workspacePath } = useLastUsedWorkspace();
  const { theme: currentTheme } = useTheme();
  const { currentLanguage } = useI18n();
  const themeRef = useRef(currentTheme);
  themeRef.current = currentTheme;
  const localeRef = useRef(currentLanguage);
  localeRef.current = currentLanguage;
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;
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
      const reply = (result: unknown) =>
        iframeRef.current?.contentWindow?.postMessage({ jsonrpc: '2.0', id, result }, '*');
      const replyError = (message: string) =>
        iframeRef.current?.contentWindow?.postMessage(
          { jsonrpc: '2.0', id, error: { code: -32000, message } },
          '*',
        );

      if (method === 'sparo/request-theme') {
        const payload = buildLiveAppThemeVars(themeRef.current);
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
        void liveAppAPI.reportRuntimeIssue({
          appId,
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
        if (logEntry.message) {
          void liveAppAPI.reportRuntimeLog({
            appId,
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
          const result = await liveAppAPI.workerCall(
            appId,
            method,
            params,
            workspacePathRef.current || undefined,
          );
          reply(result);
          return;
        }
        if (method === 'worker.call') {
          useLiveAppStore.getState().markWorkerRunning(appId);
          const result = await liveAppAPI.workerCall(
            appId,
            (params.method as string) ?? '',
            (params.params as Record<string, unknown>) ?? {},
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
          const result = await liveAppAPI.aiComplete(appId, (params.prompt as string) ?? '', {
            systemPrompt: params.systemPrompt as string | undefined,
            model: params.model as string | undefined,
            maxTokens: params.maxTokens as number | undefined,
            temperature: params.temperature as number | undefined,
          });
          reply(result);
          return;
        }
        if (method === 'ai.chat') {
          const result = await liveAppAPI.aiChat(
            appId,
            (params.messages as { role: 'user' | 'assistant'; content: string }[]) ?? [],
            (params.streamId as string) ?? '',
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
          await liveAppAPI.aiCancel(appId, (params.streamId as string) ?? '');
          reply(null);
          return;
        }
        if (method === 'ai.getModels') {
          const models = await liveAppAPI.aiListModels(appId);
          reply(models);
          return;
        }

        if (method === 'backend.call') {
          const result = await liveAppAPI.backendCall(
            appId,
            (params.target as string) ?? '',
            params.input,
            {
              entityId: params.entityId as string | undefined,
              idempotencyKey: params.idempotencyKey as string | undefined,
            },
          );
          agenticSessionIdsRef.current.add(result.sessionId);
          flowChatStore.addExternalSession(
            result.sessionId,
            `${result.backendId}.${result.action}`,
            result.agentType,
            undefined,
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
    const payload = buildLiveAppThemeVars(currentTheme);
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
    const unlisten = api.listen<AiStreamPayload>('liveapp://ai-stream', (payload) => {
      if (!iframeRef.current?.contentWindow) return;
      if (payload.appId !== currentAppId) return;
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
  }, [app.id, iframeRef]);

  useEffect(() => {
    const currentAppId = app.id;
    const eventName = `liveapp://worker-event:${currentAppId}`;
    const unlisten = api.listen<{ appId: string; event: string; data: unknown }>(
      eventName,
      (payload) => {
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
  }, [app.id, iframeRef]);

  useEffect(() => {
    const eventNames = [
      'agentic://session-created',
      'agentic://session-state-changed',
      'agentic://dialog-turn-started',
      'agentic://model-round-started',
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
