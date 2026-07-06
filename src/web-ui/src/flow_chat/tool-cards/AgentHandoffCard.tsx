/**
 * AgentHandoff tool card.
 *
 * Compact row style (CompactToolCard), aligned with shell / session_control tools.
 * Clicking the header when handoff completed jumps to the created session.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Check, Clock, X, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolCard } from './CompactToolCard';
import { ToolCompactHeaderLayout } from './ToolHeaderLayout';
import { openMainSession } from '../services/childSessionPanels';
import { flowChatStore } from '../store/FlowChatStore';
import { useSessionsExecutionRunning } from '../hooks/useSessionsExecutionRunning';
import { useFlowLayoutMutationContract } from '../scroll/useFlowLayoutMutationContract';
import { sessionAPI } from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { getToolViewState } from '../runtime/toolViewState';
import './AgentHandoffCard.scss';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = createLogger('AgentHandoffCard');

function parseData<T>(value: unknown): T | null {
  if (!value) return null;
  try {
    return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
  } catch {
    return null;
  }
}

interface AgentHandoffInput {
  action?: 'handoff' | 'dispatch' | 'list' | 'status';
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

interface AgentHandoffSession {
  session_id?: string;
  session_name?: string;
  agent_type?: string;
  workspace?: string;
  workspace_kind?: 'global' | 'project';
}

interface AgentHandoffResult {
  action?: 'handoff' | 'dispatch' | 'list' | 'status';
  success?: boolean;
  handoff_kind?: 'created' | 'reused';
  dispatch_kind?: 'created' | 'reused';
  session_id?: string;
  session_name?: string;
  agent_type?: string;
  workspace?: string;
  workspace_count?: number;
  workspaces?: WorkspaceEntry[];
  os_agent_session_count?: number;
  dispatcher_session_count?: number;
  sessions?: AgentHandoffSession[];
}

type AgentHandoffAction = 'handoff' | 'list' | 'status';

function normalizeAction(action: AgentHandoffInput['action']): AgentHandoffAction {
  return action === 'dispatch' ? 'handoff' : action ?? 'handoff';
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
    log.warn('Failed to hydrate handed-off session before navigation', {
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
  Runno: 'var(--ds-status-surface-info-fg)',
  'bitfun-coder': 'var(--ds-status-surface-info-fg)',
  'bitfun-plan': 'var(--ds-status-surface-warning-fg)',
  'bitfun-debug': 'var(--ds-status-surface-danger-fg)',
  'bitfun-team': 'var(--ds-status-surface-success-fg)',
  Cowork: 'var(--ds-status-surface-success-fg)',
};

function AgentBadge({ agentType, compact }: { agentType: string; compact?: boolean }) {
  const color = AGENT_TYPE_COLORS[agentType] ?? 'var(--ds-tool-family-agent-fg)';
  return (
    <span
      className={[
        'agent-handoff-badge',
        compact ? 'agent-handoff-badge--compact' : '',
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

export const AgentHandoffCard: React.FC<ToolCardProps> = React.memo(
  ({ toolItem }) => {
    const { t } = useTranslation('flow-chat');
    const { toolCall, toolResult, status } = toolItem;
    const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
    const isCompleted = viewState.phase === 'result';
    const toolId = toolItem.id ?? toolCall?.id;

    const [isExpanded, setIsExpanded] = useState(false);
    const { cardRootRef, applyExpandedState } = useFlowLayoutMutationContract({
      toolId,
      toolName: toolItem.toolName,
    });

    const inputData = useMemo(
      () => parseData<AgentHandoffInput>(toolCall?.input) ?? {},
      [toolCall?.input]
    );
    const resultData = useMemo(
      () => parseData<AgentHandoffResult>(toolResult?.result),
      [toolResult?.result]
    );

    const action = normalizeAction(resultData?.action ?? inputData.action);
    const handoffKind =
      resultData?.handoff_kind ?? resultData?.dispatch_kind ?? (inputData.session_id ? 'reused' : 'created');
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

    /** Collapsed header status icon; same vocabulary as SessionControl / LS (compact tools). */
    const headerStatusIcon = useMemo(() => {
      switch (viewState.phase) {
        case 'running':
        case 'receiving_input':
          return <DotMatrixLoader size="tiny" className="agent-handoff-dot-matrix" />;
        case 'result':
          return <Check size={12} className="icon-check-done" />;
        case 'cancelled':
        case 'interrupted':
        case 'error':
          return <X size={12} />;
        default:
          return <Clock size={12} />;
      }
    }, [viewState.phase]);

    /** Right rail: live child session execution when handoff completed (no duplicate of left status icon). */
    const headerRailIcon = useMemo(() => {
      if (action === 'handoff' && isCompleted && createdSessionId) {
        if (runningSessionIds.has(createdSessionId)) {
          const runLabel = t('toolCards.agentHandoff.sessionRunning');
          return (
            <span className="agent-handoff-dot-matrix-wrap agent-handoff-dot-matrix-wrap--rail" title={runLabel}>
              <DotMatrixLoader size="small" className="agent-handoff-dot-matrix" />
            </span>
          );
        }
      }
      return undefined;
    }, [action, createdSessionId, isCompleted, runningSessionIds, t]);

    // Header text
    const headerLine = useMemo(() => {
      if (action === 'list') {
        if (isCompleted) {
          const count = resultData?.workspace_count ?? 0;
          return t('toolCards.agentHandoff.foundWorkspaces', { count });
        }
        return t('toolCards.agentHandoff.listingWorkspaces');
      }
      if (action === 'status') {
        if (isCompleted) {
          const count = resultData?.os_agent_session_count ?? resultData?.dispatcher_session_count ?? 0;
          return t('toolCards.agentHandoff.statusSessions', { count });
        }
        return t('toolCards.agentHandoff.checkingStatus');
      }
      if (action === 'handoff') {
        if (isCompleted) {
          if (handoffKind === 'reused') {
            return t('toolCards.agentHandoff.reusedSession', {
              session: sessionName || createdSessionId || t('toolCards.agentHandoff.agent'),
            });
          }
          return t('toolCards.agentHandoff.createdSession', {
            agentType: agentType || t('toolCards.agentHandoff.agent'),
            session: sessionName || t('toolCards.agentHandoff.agent'),
          });
        }

        if (handoffKind === 'reused') {
          return t('toolCards.agentHandoff.reusingSession', {
            session: sessionName || createdSessionId || t('toolCards.agentHandoff.agent'),
          });
        }
      }

      const agentTypeLabel = agentType || t('toolCards.agentHandoff.agent');
      const sessionLabel = sessionName || t('toolCards.agentHandoff.agent');
      if (viewState.phase === 'error' || viewState.phase === 'cancelled' || viewState.phase === 'interrupted') {
        return t('toolCards.agentHandoff.actionFailed');
      }
      return t('toolCards.agentHandoff.headerLine', {
        agentType: agentTypeLabel,
        session: sessionLabel,
      });
    }, [action, agentType, createdSessionId, handoffKind, isCompleted, resultData, sessionName, viewState.phase, t]);

    const canNavigate = action === 'handoff' && isCompleted && !!createdSessionId;

    const openHandedOffSession = useCallback(
      async (sessionId: string, sessionWorkspace?: string) => {
        const available = await ensureSessionAvailable(sessionId, sessionWorkspace);
        if (!available) {
          notificationService.warning(t('toolCards.agentHandoff.sessionUnavailable'), {
            duration: 4000,
          });
          return;
        }

        try {
          await openMainSession(sessionId);
        } catch (error) {
          log.warn('Failed to open handed-off session', { sessionId, error });
          notificationService.warning(t('toolCards.agentHandoff.openSessionFailed'), {
            duration: 4000,
          });
        }
      },
      [t]
    );

    // Expanded content (for list/status or create details)
    const expandedContent = useMemo(() => {
      if (action === 'handoff') {
        if (!workspace && !createdSessionId) return null;
        return (
          <div className="agent-handoff-details">
            {createdSessionId && (
              <div className="agent-handoff-detail-row">
                <span className="agent-handoff-detail-label">{t('toolCards.agentHandoff.sessionId')}</span>
                <span className="agent-handoff-detail-value agent-handoff-detail-value--mono">{createdSessionId}</span>
              </div>
            )}
            {workspace && (
              <div className="agent-handoff-detail-row">
                <span className="agent-handoff-detail-label">{t('toolCards.agentHandoff.workspace')}</span>
                <span className="agent-handoff-detail-value">{workspace}</span>
              </div>
            )}
          </div>
        );
      }

      if (action === 'list') {
        const workspaces = resultData?.workspaces ?? [];
        if (!workspaces.length) return <div className="agent-handoff-empty">{t('toolCards.agentHandoff.noWorkspaces')}</div>;
        return (
          <div className="compact-detail-list agent-handoff-workspace-list">
            {workspaces.map((ws, i) => (
              <div
                key={i}
                className={[
                  'compact-list-item',
                  'agent-handoff-workspace-row',
                  ws.kind === 'global' ? 'agent-handoff-workspace-row--global' : '',
                  !ws.path ? 'agent-handoff-workspace-row--no-path' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="agent-handoff-workspace-row-head">
                  <span className="agent-handoff-workspace-name">{ws.name ?? ws.path}</span>
                  {ws.kind === 'global' && (
                    <span className="agent-handoff-global-tag agent-handoff-global-tag--compact">
                      {t('toolCards.agentHandoff.globalTag')}
                    </span>
                  )}
                </div>
                {ws.path ? (
                  <span className="agent-handoff-workspace-path" title={ws.path}>
                    {ws.path}
                  </span>
                ) : null}
                <span className="agent-handoff-workspace-count">
                  {t('toolCards.agentHandoff.sessionCount', { count: ws.session_count ?? 0 })}
                </span>
              </div>
            ))}
          </div>
        );
      }

      if (action === 'status') {
        const sessions = resultData?.sessions ?? [];
        if (!sessions.length) return <div className="agent-handoff-empty">{t('toolCards.agentHandoff.noSessions')}</div>;
        return (
          <div className="compact-detail-list agent-handoff-session-list">
            {sessions.map((s, i) => {
              const sid = s.session_id;
              const isRunning = sid ? runningSessionIds.has(sid) : false;
              return (
                <div
                  key={sid ?? `row-${i}`}
                  className={[
                    'compact-list-item',
                    'agent-handoff-session-row',
                    sid ? 'agent-handoff-session-row--clickable' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={sid ? () => void openHandedOffSession(sid, s.workspace) : undefined}
                  onKeyDown={
                    sid
                      ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void openHandedOffSession(sid, s.workspace);
                        }
                      }
                      : undefined
                  }
                  role={sid ? 'button' : undefined}
                  tabIndex={sid ? 0 : undefined}
                >
                  <div className="agent-handoff-session-row-main">
                    <span className="agent-handoff-session-name">{s.session_name ?? s.session_id}</span>
                    {s.agent_type && <AgentBadge agentType={s.agent_type} compact />}
                  </div>
                  {s.workspace ? (
                    <span className="agent-handoff-session-path" title={s.workspace}>
                      {s.workspace}
                    </span>
                  ) : null}
                  <div className="agent-handoff-session-row-rail">
                    {sid ? (
                      isRunning ? (
                        <span
                          className="agent-handoff-dot-matrix-wrap"
                          title={t('toolCards.agentHandoff.sessionRunning')}
                        >
                          <DotMatrixLoader size="small" className="agent-handoff-dot-matrix" />
                        </span>
                      ) : (
                        <span
                          className="agent-handoff-session-idle-dot"
                          title={t('toolCards.agentHandoff.sessionIdle')}
                          aria-label={t('toolCards.agentHandoff.sessionIdle')}
                        />
                      )
                    ) : null}
                    {sid ? (
                      <ExternalLink size={11} className="agent-handoff-session-link-icon" aria-hidden />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      return null;
    }, [action, createdSessionId, openHandedOffSession, resultData, runningSessionIds, t, workspace]);

    const hasExpandedContent = !!expandedContent;

    const headerExtra =
      workspace && action === 'handoff'
        ? (
          workspace === 'global'
            ? (
              <span className="agent-handoff-global-tag agent-handoff-global-tag--compact">
                {t('toolCards.agentHandoff.globalTag')}
              </span>
            )
            : <span className="agent-handoff-header-path" title={workspace}>{workspace}</span>
        )
        : undefined;

    const handleCardClick = useCallback(() => {
      if (action === 'handoff' && isCompleted && createdSessionId) {
        void openHandedOffSession(createdSessionId, workspace);
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
      openHandedOffSession,
      isCompleted,
      workspace,
    ]);

    const headerClickable = canNavigate || hasExpandedContent;

    return (
      <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
        <CompactToolCard
          status={status}
          isExpanded={isExpanded}
          onClick={headerClickable ? handleCardClick : undefined}
          className="agent-handoff-card"
          clickable={headerClickable}
          header={(
            <ToolCompactHeaderLayout
              statusIcon={headerStatusIcon}
              expandable={hasExpandedContent}
              isExpanded={isExpanded}
              action={`${t('toolCards.agentHandoff.title')}:`}
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

AgentHandoffCard.displayName = 'AgentHandoffCard';
