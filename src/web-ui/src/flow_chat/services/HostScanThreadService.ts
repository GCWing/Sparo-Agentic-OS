import { hostScanAPI } from '@/infrastructure/api/service-api/HostScanAPI';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { flowChatStore } from '../store/FlowChatStore';
import type { Session } from '../types/flow-chat';

const log = createLogger('HostScanThreadService');

function safeUuid(prefix = 'host_scan'): string {
  try {
    const fn = (globalThis as any)?.crypto?.randomUUID as (() => string) | undefined;
    if (fn) return fn();
  } catch {
    // ignore
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function requireSession(sessionId: string): Session {
  const session = flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}

export function createTransientHostScanSession(params: {
  parentSessionId: string;
  workspacePath?: string;
  childSessionName?: string;
  modelId?: string;
}): { childSessionId: string } {
  const parentSession = requireSession(params.parentSessionId);
  const workspacePath = params.workspacePath || parentSession.workspacePath;
  if (!workspacePath) {
    throw new Error(
      `Workspace path is required for host scan child session: ${params.parentSessionId}`
    );
  }

  const childSessionId = safeUuid('host_scan_session');
  const childSessionName =
    params.childSessionName?.trim() ||
    i18nService.t('flow-chat:hostScan.threadLabel', { defaultValue: 'Host scan' });
  const inheritedModelId = params.modelId?.trim() || parentSession.config.modelName?.trim() || 'primary';

  flowChatStore.addExternalSession(
    childSessionId,
    childSessionName,
    'Dispatcher',
    workspacePath,
    {
      parentSessionId: params.parentSessionId,
      sessionKind: 'host_scan',
      isTransient: true,
    },
    parentSession.storageScope
  );
  flowChatStore.updateSessionModelName(childSessionId, inheritedModelId);

  return { childSessionId };
}

export async function startHostScanThread(params: {
  parentSessionId: string;
  workspacePath: string;
  modelId?: string;
}): Promise<{ requestId: string; childSessionId: string }> {
  const childSessionName = i18nService.t('flow-chat:hostScan.threadLabel', {
    defaultValue: 'Host scan',
  });
  const { childSessionId } = createTransientHostScanSession({
    parentSessionId: params.parentSessionId,
    workspacePath: params.workspacePath,
    childSessionName,
    modelId: params.modelId,
  });

  try {
    const requestId = safeUuid('host_scan');
    await hostScanAPI.startStream({
      requestId,
      parentSessionId: params.parentSessionId,
      childSessionId,
      childSessionName,
      modelId: params.modelId,
    });
    return { requestId, childSessionId };
  } catch (error) {
    log.error('Failed to start host scan thread', { error, childSessionId });
    flowChatStore.removeSession(childSessionId);
    throw error;
  }
}
