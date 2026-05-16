/**
 * AgentDispatch tool card.
 *
 * Compact row style (CompactToolCard), aligned with shell / session_control tools.
 * Clicking the header when dispatch completed jumps to the created session.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Check, Clock, Loader2, X, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolCard } from './CompactToolCard';
import { ToolCompactHeaderLayout } from './ToolHeaderLayout';
import { openMainSession } from '../services/childSessionPanels';
import { flowChatStore } from '../store/FlowChatStore';
import { useSessionsExecutionRunning } from '../hooks/useSessionsExecutionRunning';
import { useToolCardHeightContract } from './useToolCardHeightContract';
import { sessionAPI } from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './AgentDispatchCard.scss';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = createLogger('AgentDispatchCard');

function parseData<T>(value: unknown): T | null {
  if (!value) return null;
  try {
    return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
  } catch {
    return null;
  }
}

interface AgentDispatchInput {
  action?: 'dispatch' | 'list' | 'status';
  workspace?: string;
  session_id?: string;
  agent_type?: string;
  session_name?: string;
  message?: string;
}

interface WorkspaceEntry {
  name?: string;
  path?: string;
  kind?: 'global' | 'project';
  session_count?: number;
  sessions?: Array<{
    session_id?: string;
    session_name?: string;
    agent_type?: string;
  }>;
}

interface DispatcherSession {
  session_id?: string;
  session_name?: string;
  agent_type?: string;
  workspace?: string;
  workspace_kind?: 'global' | 'project';
}

interface AgentDispatchResult {
  action?: 'dispatch' | 'list' | 'status';
  success?: boolean;
  dispatch_kind?: 'created' | 'reused';
  session_id?: string;
  session_name?: string;
  agent_type?: string;
  workspace?: string;
  workspace_count?: number;
  workspaces?: WorkspaceEntry[];
  dispatcher_session_count?: number;
  sessions?: DispatcherSession[];
}

async function ensureSessionAvailable(sessionId: string, workspace?: string): Promise<boolean> {
  if (flowChatStore.getState().sessions.has(sessionId)) {
    return true;
  }

  const workspacePath = workspace?.trim();
  if (!workspacePath || workspacePath === 'global') {
    return false;
  }

  try {
    const metadata = await sessionAPI.loadSessionMetadata(sessionId, workspacePath);
    if (!metadata) {
      return false;
    }

    await flowChatStore.hydrateWorkspaceSessionsMetadata(
      [metadata],
      metadata.workspacePath || workspacePath,
      metadata.storageScope
    );

    return flowChatStore.getState().sessions.has(sessionId);
  } catch (error) {
    log.warn('Failed to hydrate dispatched session before navigation', {
      sessionId,
      workspacePath,
      error,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Agent type badge color map
// ---------------------------------------------------------------------------

const AGENT_TYPE_COLORS: Record<string, string> = {
  agentic: 'var(--ds-status-surface-info-fg)',
  Plan: 'var(--ds-status-surface-warning-fg)',
  Cowork: 'var(--ds-status-surface-success-fg)',
  debug: 'var(--ds-status-surface-danger-fg)',
};

function AgentBadge({ agentType, compact }: { agentType: string; compact?: boolean }) {
  const color = AGENT_TYPE_COLORS[agentType] ?? 'var(--ds-tool-family-agent-app-fg)';
  return (
    <span
      className={[
        'agent-dispatch-badge',
        compact ? 'agent-dispatch-badge--compact' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--agent-badge-color': color } as React.CSSProperties}
    >
      {agentType}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const AgentDispatchCard: React.FC<ToolCardProps> = React.memo(
  ({ toolItem }) => {
    const { t } = useTranslation('flow-chat');
    const { toolCall, toolResult, status } = toolItem;
    const toolId = toolItem.id ?? toolCall?.id;

    const [isExpanded, setIsExpanded] = useState(false);
    const { cardRootRef, applyExpandedState } = useToolCardHeightContract({
      toolId,
      toolName: toolItem.toolName,
    });

    const inputData = useMemo(
      () => parseData<AgentDispatchInput>(toolCall?.input) ?? {},
      [toolCall?.input]
    );
    const resultData = useMemo(
      () => parseData<AgentDispatchResult>(toolResult?.result),
      [toolResult?.result]
    );

    const action = resultData?.action ?? inputData.action ?? 'dispatch';
    const dispatchKind =
      resultData?.dispatch_kind ?? (inputData.session_id ? 'reused' : 'created');
    const agentType = resultData?.agent_type ?? inputData.agent_type ?? '';
    const sessionName = resultData?.session_name ?? inputData.session_name ?? '';
    const workspace = resultData?.workspace ?? inputData.workspace ?? '';
    const createdSessionId = resultData?.session_id;

    const trackedSessionIds = useMemo(() => {
      const ids: string[] = [];
      if (createdSessionId) ids.push(createdSessionId);
      if (action === 'status') {
        for (const s of resultData?.sessions ?? []) {
          if (s.session_id) ids.push(s.session_id);
        }
      }
      return ids;
    }, [action, createdSessionId, resultData?.sessions]);

    const runningSessionIds = useSessionsExecutionRunning(trackedSessionIds);

    /** Collapsed header status icon — same vocabulary as SessionControl / LS (compact tools). */
    const headerStatusIcon = useMemo(() => {
      switch (status) {
        case 'running':
        case 'streaming':
          return <Loader2 className="animate-spin" size={12} />;
        case 'completed':
          return <Check size={12} className="icon-check-done" />;
        case 'error':
        case 'cancelled':
          return <X size={12} />;
        case 'pending':
        case 'preparing':
        default:
          return <Clock size={12} />;
      }
    }, [status]);

    /** Right rail: live child session execution when dispatch completed (no duplicate of left status icon). */
    const headerRailIcon = useMemo(() => {
      if (action === 'dispatch' && status === 'completed' && createdSessionId) {
        if (runningSessionIds.has(createdSessionId)) {
          const runLabel = t('toolCards.agentDispatch.sessionRunning');
          return (
            <span className="agent-dispatch-dot-matrix-wrap agent-dispatch-dot-matrix-wrap--rail" title={runLabel}>
              <DotMatrixLoader size="small" className="agent-dispatch-dot-matrix" />
            </span>
          );
        }
      }
      return undefined;
    }, [action, createdSessionId, runningSessionIds, status, t]);

    // Header text
    const headerLine = useMemo(() => {
      if (action === 'list') {
        if (status === 'completed') {
          const count = resultData?.workspace_count ?? 0;
          return t('toolCards.agentDispatch.foundWorkspaces', { count });
        }
        return t('toolCards.agentDispatch.listingWorkspaces');
      }
      if (action === 'status') {
        if (status === 'completed') {
          const count = resultData?.dispatcher_session_count ?? 0;
          return t('toolCards.agentDispatch.statusSessions', { count });
        }
        return t('toolCards.agentDispatch.checkingStatus');
      }
      if (action === 'dispatch') {
        if (status === 'completed') {
          if (dispatchKind === 'reused') {
            return t('toolCards.agentDispatch.reusedSession', {
              session: sessionName || createdSessionId || t('toolCards.agentDispatch.agent'),
            });
          }
          return t('toolCards.agentDispatch.createdSession', {
            agentType: agentType || t('toolCards.agentDispatch.agent'),
            session: sessionName || t('toolCards.agentDispatch.agent'),
          });
        }

        if (dispatchKind === 'reused') {
          return t('toolCards.agentDispatch.reusingSession', {
            session: sessionName || createdSessionId || t('toolCards.agentDispatch.agent'),
          });
        }
      }

      const agentTypeLabel = agentType || t('toolCards.agentDispatch.agent');
      const sessionLabel = sessionName || t('toolCards.agentDispatch.agent');
      if (status === 'error' || status === 'cancelled') {
        return t('toolCards.agentDispatch.actionFailed');
      }
      return t('toolCards.agentDispatch.headerLine', {
        agentType: agentTypeLabel,
        session: sessionLabel,
      });
    }, [action, agentType, createdSessionId, dispatchKind, resultData, sessionName, status, t]);

    const canNavigate = action === 'dispatch' && status === 'completed' && !!createdSessionId;

    const openDispatchedSession = useCallback(
      async (sessionId: string, sessionWorkspace?: string) => {
        const available = await ensureSessionAvailable(sessionId, sessionWorkspace);
        if (!available) {
          notificationService.warning(t('toolCards.agentDispatch.sessionUnavailable'), {
            duration: 4000,
          });
          return;
        }

        try {
          await openMainSession(sessionId);
        } catch (error) {
          log.warn('Failed to open dispatched session', { sessionId, error });
          notificationService.warning(t('toolCards.agentDispatch.openSessionFailed'), {
            duration: 4000,
          });
        }
      },
      [t]
    );

    // Expanded content (for list/status or create details)
    const expandedContent = useMemo(() => {
      if (action === 'dispatch') {
        if (!workspace && !createdSessionId) return null;
        return (
          <div className="agent-dispatch-details">
            {createdSessionId && (
              <div className="agent-dispatch-detail-row">
                <span className="agent-dispatch-detail-label">{t('toolCards.agentDispatch.sessionId')}</span>
                <span className="agent-dispatch-detail-value agent-dispatch-detail-value--mono">{createdSessionId}</span>
              </div>
            )}
            {workspace && (
              <div className="agent-dispatch-detail-row">
                <span className="agent-dispatch-detail-label">{t('toolCards.agentDispatch.workspace')}</span>
                <span className="agent-dispatch-detail-value">{workspace}</span>
              </div>
            )}
          </div>
        );
      }

      if (action === 'list') {
        const workspaces = resultData?.workspaces ?? [];
        if (!workspaces.length) return <div className="agent-dispatch-empty">{t('toolCards.agentDispatch.noWorkspaces')}</div>;
        return (
          <div className="compact-detail-list agent-dispatch-workspace-list">
            {workspaces.map((ws, i) => (
              <div
                key={i}
                className={[
                  'compact-list-item',
                  'agent-dispatch-workspace-row',
                  ws.kind === 'global' ? 'agent-dispatch-workspace-row--global' : '',
                  !ws.path ? 'agent-dispatch-workspace-row--no-path' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="agent-dispatch-workspace-row-head">
                  <span className="agent-dispatch-workspace-name">{ws.name ?? ws.path}</span>
                  {ws.kind === 'global' && (
                    <span className="agent-dispatch-global-tag agent-dispatch-global-tag--compact">
                      {t('toolCards.agentDispatch.globalTag')}
                    </span>
                  )}
                </div>
                {ws.path ? (
                  <span className="agent-dispatch-workspace-path" title={ws.path}>
                    {ws.path}
                  </span>
                ) : null}
                <span className="agent-dispatch-workspace-count">
                  {t('toolCards.agentDispatch.sessionCount', { count: ws.session_count ?? 0 })}
                </span>
              </div>
            ))}
          </div>
        );
      }

      if (action === 'status') {
        const sessions = resultData?.sessions ?? [];
        if (!sessions.length) return <div className="agent-dispatch-empty">{t('toolCards.agentDispatch.noSessions')}</div>;
        return (
          <div className="compact-detail-list agent-dispatch-session-list">
            {sessions.map((s, i) => {
              const sid = s.session_id;
              const isRunning = sid ? runningSessionIds.has(sid) : false;
              return (
                <div
                  key={sid ?? `row-${i}`}
                  className={[
                    'compact-list-item',
                    'agent-dispatch-session-row',
                    sid ? 'agent-dispatch-session-row--clickable' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={sid ? () => void openDispatchedSession(sid, s.workspace) : undefined}
                  onKeyDown={
                    sid
                      ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void openDispatchedSession(sid, s.workspace);
                        }
                      }
                      : undefined
                  }
                  role={sid ? 'button' : undefined}
                  tabIndex={sid ? 0 : undefined}
                >
                  <div className="agent-dispatch-session-row-main">
                    <span className="agent-dispatch-session-name">{s.session_name ?? s.session_id}</span>
                    {s.agent_type && <AgentBadge agentType={s.agent_type} compact />}
                  </div>
                  {s.workspace ? (
                    <span className="agent-dispatch-session-path" title={s.workspace}>
                      {s.workspace}
                    </span>
                  ) : null}
                  <div className="agent-dispatch-session-row-rail">
                    {sid ? (
                      isRunning ? (
                        <span
                          className="agent-dispatch-dot-matrix-wrap"
                          title={t('toolCards.agentDispatch.sessionRunning')}
                        >
                          <DotMatrixLoader size="small" className="agent-dispatch-dot-matrix" />
                        </span>
                      ) : (
                        <span
                          className="agent-dispatch-session-idle-dot"
                          title={t('toolCards.agentDispatch.sessionIdle')}
                          aria-label={t('toolCards.agentDispatch.sessionIdle')}
                        />
                      )
                    ) : null}
                    {sid ? (
                      <ExternalLink size={11} className="agent-dispatch-session-link-icon" aria-hidden />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return null;
    }, [action, createdSessionId, openDispatchedSession, resultData, runningSessionIds, t, workspace]);

    const hasExpandedContent = !!expandedContent;

    const headerExtra =
      workspace && action === 'dispatch'
        ? (
          workspace === 'global'
            ? (
              <span className="agent-dispatch-global-tag agent-dispatch-global-tag--compact">
                {t('toolCards.agentDispatch.globalTag')}
              </span>
            )
            : <span className="agent-dispatch-header-path" title={workspace}>{workspace}</span>
        )
        : undefined;

    const handleCardClick = useCallback(() => {
      if (action === 'dispatch' && status === 'completed' && createdSessionId) {
        void openDispatchedSession(createdSessionId, workspace);
        return;
      }
      if (hasExpandedContent) {
        applyExpandedState(isExpanded, !isExpanded, setIsExpanded);
      }
    }, [
      action,
      applyExpandedState,
      createdSessionId,
      hasExpandedContent,
      isExpanded,
      openDispatchedSession,
      status,
      workspace,
    ]);

    const headerClickable = canNavigate || hasExpandedContent;

    return (
      <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
        <CompactToolCard
          status={status}
          isExpanded={isExpanded}
          onClick={headerClickable ? handleCardClick : undefined}
          className="agent-dispatch-card"
          clickable={headerClickable}
          header={(
            <ToolCompactHeaderLayout
              statusIcon={headerStatusIcon}
              action={`${t('toolCards.agentDispatch.title')}:`}
              content={headerLine}
              extra={headerExtra}
              rightIcon={headerRailIcon}
            />
          )}
          expandedContent={expandedContent}
        />
      </div>
    );
  }
);

AgentDispatchCard.displayName = 'AgentDispatchCard';
