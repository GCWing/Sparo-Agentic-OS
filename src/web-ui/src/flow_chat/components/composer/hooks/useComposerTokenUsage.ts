import { useEffect, useRef, useState } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { ContextBudgetSnapshot, Session } from '../../../types/flow-chat';
import { useFlowChatStoreSelector } from '../../../hooks/useFlowChatStoreSelector';
import { getBackendAgentType } from '../../../domain/sessionDescriptor';
import { contextBudgetService } from '../../../services/ContextBudgetService';

const log = createLogger('useComposerTokenUsage');
const STATIC_BUDGET_REQUEST_DELAY_MS = 300;

function resolveBudgetAgentType(session: Session): string {
  const configuredAgent = session.config.agentType?.trim();
  if (configuredAgent) return configuredAgent;
  return getBackendAgentType(session.descriptor);
}

export function useComposerTokenUsage(effectiveTargetSessionId?: string | null) {
  const requestTimerRef = useRef<number | null>(null);
  const [tokenUsage, setTokenUsage] = useState({
    current: 0,
    max: 0,
    snapshot: undefined as ContextBudgetSnapshot | undefined,
  });
  const targetSession = useFlowChatStoreSelector(
    state => effectiveTargetSessionId ? state.sessions.get(effectiveTargetSessionId) : undefined,
  );

  useEffect(() => {
    const sessionId = effectiveTargetSessionId;
    if (!sessionId) return;

    const invalidate = () => {
      FlowChatStore.getInstance().invalidateSessionContextBudget(sessionId);
    };
    const unwatch = [
      configManager.watch('core.ai.models', invalidate),
      configManager.watch('core.ai.default_models', invalidate),
      configManager.watch('core.ai.agent_models', invalidate),
    ];
    return () => {
      unwatch.forEach(dispose => dispose());
    };
  }, [effectiveTargetSessionId]);

  useEffect(() => {
    const store = FlowChatStore.getInstance();
    let cancelled = false;

    if (!targetSession) {
      setTokenUsage({
        current: 0,
        max: 0,
        snapshot: undefined,
      });
      return () => {
        cancelled = true;
      };
    }

    const session = targetSession;
    setTokenUsage({
      current: session.currentContextBudget?.totals.inputTokens || session.currentTokenUsage?.totalTokens || 0,
      max: session.currentContextBudget?.contextWindow ?? session.maxContextTokens ?? 0,
      snapshot: session.currentContextBudget,
    });

    if (!session.currentContextBudget) {
      const agentType = resolveBudgetAgentType(session);
      const modelName = session.config.modelName || 'primary';
      const workspacePath = session.workspacePath || session.config.workspacePath;
      if (session.domain.kind === 'workspace' && !workspacePath?.trim()) {
        return () => {
          cancelled = true;
        };
      }

      if (requestTimerRef.current !== null) {
        window.clearTimeout(requestTimerRef.current);
      }

      requestTimerRef.current = window.setTimeout(() => {
        contextBudgetService
          .loadStaticBudget({
            sessionId: session.sessionId,
            agentType,
            workspacePath,
            modelId: modelName,
            domain: session.domain,
          })
          .then(snapshot => {
            log.debug('Loaded static context budget', {
              sessionId: session.sessionId,
              snapshotId: snapshot.id,
              segmentCount: snapshot.segments.length,
              inputTokens: snapshot.totals.inputTokens,
              contextWindow: snapshot.contextWindow,
            });
            if (!cancelled) {
              store.updateContextBudget(session.sessionId, snapshot);
            }
          })
          .catch(error => {
            log.warn('Failed to load static context budget', {
              sessionId: session.sessionId,
              agentType,
              modelName,
              workspacePath,
              domain: session.domain,
              error,
            });
          });
      }, STATIC_BUDGET_REQUEST_DELAY_MS);
    }

    return () => {
      cancelled = true;
      if (requestTimerRef.current !== null) {
        window.clearTimeout(requestTimerRef.current);
        requestTimerRef.current = null;
      }
    };
  }, [targetSession]);

  return tokenUsage;
}
