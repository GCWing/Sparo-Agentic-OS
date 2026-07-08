import { sessionAPI } from '@/infrastructure/api';
import { normalizePath } from '@/shared/utils/pathUtils';
import type { SessionStorageScope } from '@/shared/types/session-history';
import type { ContextBudgetSnapshot } from '../types/flow-chat';

const STATIC_BUDGET_CACHE_TTL_MS = 30_000;

export interface StaticContextBudgetRequest {
  sessionId: string;
  agentType: string;
  modelId?: string;
  workspacePath?: string;
  storageScope?: SessionStorageScope;
}

interface CachedBudgetSnapshot {
  snapshot: ContextBudgetSnapshot;
  expiresAt: number;
}

function normalizeWorkspaceKey(
  workspacePath: string | undefined,
  storageScope: SessionStorageScope | undefined,
): string {
  if (storageScope === 'agentic_os') {
    return 'scope:agentic_os';
  }

  const trimmed = workspacePath?.trim();
  if (!trimmed) {
    return 'scope:workspace:pending';
  }

  const normalized = normalizePath(trimmed);
  return /^[a-zA-Z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizeModelKey(modelId: string | undefined): string {
  const trimmed = modelId?.trim();
  return trimmed || 'primary';
}

function buildStaticBudgetKey(request: StaticContextBudgetRequest): string {
  return [
    request.sessionId,
    request.agentType.trim() || 'Runno',
    normalizeModelKey(request.modelId),
    request.storageScope || 'workspace',
    normalizeWorkspaceKey(request.workspacePath, request.storageScope),
  ].join('\u001f');
}

function cloneSnapshotForSession(
  snapshot: ContextBudgetSnapshot,
  sessionId: string,
): ContextBudgetSnapshot {
  if (snapshot.sessionId === sessionId) {
    return snapshot;
  }

  return {
    ...snapshot,
    sessionId,
  };
}

export class ContextBudgetService {
  private readonly inFlightStaticBudgets = new Map<string, Promise<ContextBudgetSnapshot>>();
  private readonly staticBudgetCache = new Map<string, CachedBudgetSnapshot>();

  public loadStaticBudget(request: StaticContextBudgetRequest): Promise<ContextBudgetSnapshot> {
    const key = buildStaticBudgetKey(request);
    const now = Date.now();
    const cached = this.staticBudgetCache.get(key);

    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cloneSnapshotForSession(cached.snapshot, request.sessionId));
    }

    const inFlight = this.inFlightStaticBudgets.get(key);
    if (inFlight) {
      return inFlight.then(snapshot => cloneSnapshotForSession(snapshot, request.sessionId));
    }

    const promise = sessionAPI
      .getContextBudget(
        request.sessionId,
        request.agentType,
        request.workspacePath,
        request.modelId,
        request.storageScope,
      )
      .then(snapshot => {
        this.staticBudgetCache.set(key, {
          snapshot,
          expiresAt: Date.now() + STATIC_BUDGET_CACHE_TTL_MS,
        });
        return snapshot;
      })
      .finally(() => {
        this.inFlightStaticBudgets.delete(key);
      });

    this.inFlightStaticBudgets.set(key, promise);
    return promise.then(snapshot => cloneSnapshotForSession(snapshot, request.sessionId));
  }

  public clearCache(): void {
    this.inFlightStaticBudgets.clear();
    this.staticBudgetCache.clear();
  }
}

export const contextBudgetService = new ContextBudgetService();
