import { sessionAPI } from '@/infrastructure/api';
import { normalizePath } from '@/shared/utils/pathUtils';
import type { SessionDomain } from '@/shared/types/session-history';
import type { ContextBudgetSnapshot } from '../types/flow-chat';

export interface StaticContextBudgetRequest {
  sessionId: string;
  agentType: string;
  modelId?: string;
  workspacePath?: string;
  domain: SessionDomain;
}

function normalizeWorkspaceKey(
  workspacePath: string | undefined,
): string {
  const trimmed = workspacePath?.trim();
  if (!trimmed) return 'no-execution-workspace';

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
    request.domain.kind,
    request.domain.kind === 'workspace' ? request.domain.workspace_id : '',
    normalizeWorkspaceKey(request.workspacePath),
  ].join('\u001f');
}

export class ContextBudgetService {
  private readonly inFlightStaticBudgets = new Map<string, Promise<ContextBudgetSnapshot>>();

  public loadStaticBudget(request: StaticContextBudgetRequest): Promise<ContextBudgetSnapshot> {
    const key = buildStaticBudgetKey(request);
    const inFlight = this.inFlightStaticBudgets.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = sessionAPI
      .getContextBudget(
        { session_id: request.sessionId, domain: request.domain },
        request.agentType,
        request.workspacePath,
        request.modelId,
      )
      .finally(() => {
        this.inFlightStaticBudgets.delete(key);
      });

    this.inFlightStaticBudgets.set(key, promise);
    return promise;
  }

  public clearCache(): void {
    this.inFlightStaticBudgets.clear();
  }
}

export const contextBudgetService = new ContextBudgetService();
