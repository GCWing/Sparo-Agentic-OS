/**
 * useLiveAppBridge — handles postMessage JSON-RPC from the Live App iframe:
 * worker.call → JS Worker, dialog.open/save/message → Tauri dialog,
 * ai.* → Host AI client, clipboard.* → Host navigator.clipboard.
 * Also handles bitfun/request-theme and pushes theme changes to the iframe.
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
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';

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
  'bitfun/sandbox-wheel',
]);

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

      if (method === 'bitfun/request-theme') {
        const payload = buildLiveAppThemeVars(themeRef.current);
        if (payload && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: 'bitfun:event', event: 'themeChange', payload },
            '*',
          );
        }
        return;
      }

      if (method === 'bitfun/request-locale') {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: 'bitfun:event', event: 'localeChange', payload: { locale: localeRef.current } },
            '*',
          );
        }
        return;
      }

      if (method === 'bitfun/runtime-error') {
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

      if (method === 'bitfun/runtime-log') {
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
        if (method === 'worker.call') {
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

        if (method === 'agentic.createSession') {
          const result = await liveAppAPI.agenticCreateSession(appId, {
            sessionName: params.sessionName as string | undefined,
            name: params.name as string | undefined,
            agentType: params.agentType as string | undefined,
            model: params.model as string | undefined,
            workspacePath: params.workspacePath as string | undefined,
          });
          agenticSessionIdsRef.current.add(result.sessionId);
          flowChatStore.addExternalSession(
            result.sessionId,
            result.sessionName,
            result.agentType,
            result.workspacePath,
          );
          reply(result);
          return;
        }
        if (method === 'agentic.sendMessage') {
          const result = await liveAppAPI.agenticSendMessage(
            appId,
            (params.sessionId as string) ?? '',
            (params.prompt as string) ?? '',
            {
              originalPrompt: params.originalPrompt as string | undefined,
              agentType: params.agentType as string | undefined,
              turnId: params.turnId as string | undefined,
            },
          );
          agenticSessionIdsRef.current.add(result.sessionId);
          reply(result);
          return;
        }
        if (method === 'agentic.cancelTurn') {
          await liveAppAPI.agenticCancelTurn(appId, (params.sessionId as string) ?? '', (params.turnId as string) ?? '');
          reply(null);
          return;
        }
        if (method === 'agentic.listSessions') {
          const sessions = await liveAppAPI.agenticListSessions(appId);
          sessions.forEach((session) => agenticSessionIdsRef.current.add(session.sessionId));
          reply(sessions);
          return;
        }
        if (method === 'agentic.restoreSession') {
          const result = await liveAppAPI.agenticRestoreSession(appId, (params.sessionId as string) ?? '');
          agenticSessionIdsRef.current.add(result.sessionId);
          flowChatStore.addExternalSession(
            result.sessionId,
            result.sessionName,
            result.agentType,
            result.workspacePath,
          );
          reply(result);
          return;
        }
        if (method === 'agentic.deleteSession') {
          const sessionId = (params.sessionId as string) ?? '';
          await liveAppAPI.agenticDeleteSession(appId, sessionId);
          agenticSessionIdsRef.current.delete(sessionId);
          reply(null);
          return;
        }
        if (method === 'agentic.confirmTool') {
          await liveAppAPI.agenticConfirmTool(
            appId,
            (params.sessionId as string) ?? '',
            (params.toolId as string) ?? '',
            params.updatedInput,
          );
          reply(null);
          return;
        }
        if (method === 'agentic.rejectTool') {
          await liveAppAPI.agenticRejectTool(
            appId,
            (params.sessionId as string) ?? '',
            (params.toolId as string) ?? '',
            params.reason as string | undefined,
          );
          reply(null);
          return;
        }
        if (method === 'agentic.openSession') {
          const sessionId = (params.sessionId as string) ?? '';
          if (!agenticSessionIdsRef.current.has(sessionId)) {
            await liveAppAPI.agenticRestoreSession(appId, sessionId);
            agenticSessionIdsRef.current.add(sessionId);
          }
          await openMainSession(sessionId);
          reply(null);
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
      { type: 'bitfun:event', event: 'themeChange', payload },
      '*',
    );
  }, [currentTheme, iframeRef]);

  useEffect(() => {
    if (!currentLanguage || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'bitfun:event', event: 'localeChange', payload: { locale: currentLanguage } },
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
          type: 'bitfun:event',
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
            type: 'bitfun:event',
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
            type: 'bitfun:event',
            event: 'agentic:event',
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
