import { useEffect, useRef, useState } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { ContextBudgetSnapshot, Session } from '../../../types/flow-chat';
import { useFlowChatStoreSelector } from '../../../hooks/useFlowChatStoreSelector';

const log = createLogger('useComposerTokenUsage');

function resolveBudgetAgentType(session: Session): string {
  const configuredAgent = session.config.agentType?.trim();
  if (configuredAgent) return configuredAgent;

  const mode = session.mode?.trim();
  if (!mode) return 'agentic';

  const normalizedMode = mode.toLowerCase();
  if (normalizedMode === 'code' || normalizedMode === 'coding') return 'agentic';
  if (normalizedMode === 'cowork') return 'Cowork';
  if (normalizedMode === 'design') return 'Design';
  if (normalizedMode === 'plan') return 'Plan';
  if (normalizedMode === 'deepresearch' || normalizedMode === 'deep-research') return 'DeepResearch';
  if (normalizedMode === 'liveappstudio' || normalizedMode === 'live-app-studio') return 'LiveAppStudio';
  if (normalizedMode === 'agentappstudio' || normalizedMode === 'agent-app-studio') return 'AgentAppStudio';
  if (normalizedMode === 'dispatcher') return 'Dispatcher';
  return mode;
}

export function useComposerTokenUsage(effectiveTargetSessionId?: string | null) {
  const requestedStaticBudgets = useRef(new Set<string>());
  const [tokenUsage, setTokenUsage] = useState({
    current: 0,
    max: 128128,
    snapshot: undefined as ContextBudgetSnapshot | undefined,
  });
  const targetSession = useFlowChatStoreSelector(
    state => effectiveTargetSessionId ? state.sessions.get(effectiveTargetSessionId) : undefined,
  );

  useEffect(() => {
    const store = FlowChatStore.getInstance();
    let cancelled = false;

    if (!targetSession) {
      setTokenUsage({
        current: 0,
        max: 128128,
        snapshot: undefined,
      });
      return () => {
        cancelled = true;
      };
    }

    const session = targetSession;
    setTokenUsage({
      current: session.currentContextBudget?.totals.inputTokens || session.currentTokenUsage?.totalTokens || 0,
      max: session.currentContextBudget?.contextWindow || session.maxContextTokens || 128128,
      snapshot: session.currentContextBudget,
    });

    if (!session.currentContextBudget) {
      const agentType = resolveBudgetAgentType(session);
      const modelName = session.config.modelName || 'primary';
      const workspacePath = session.workspacePath || session.config.workspacePath;
      const storageScope = session.storageScope || session.config.storageScope;
      const requestKey = [
        session.sessionId,
        agentType,
        modelName,
        workspacePath || '',
        storageScope || '',
      ].join(':');
      if (!requestedStaticBudgets.current.has(requestKey)) {
        requestedStaticBudgets.current.add(requestKey);
        api.invoke<ContextBudgetSnapshot>('get_context_budget', {
          request: {
            session_id: session.sessionId,
            agent_type: agentType,
            workspace_path: workspacePath,
            model_id: modelName,
            storage_scope: storageScope,
          },
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
            requestedStaticBudgets.current.delete(requestKey);
          })
          .catch(error => {
            log.warn('Failed to load static context budget', {
              sessionId: session.sessionId,
              agentType,
              modelName,
              workspacePath,
              storageScope,
              error,
            });
            requestedStaticBudgets.current.delete(requestKey);
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [targetSession]);

  return tokenUsage;
}
