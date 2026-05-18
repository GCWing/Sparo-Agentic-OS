import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import './SessionControlToolCard.scss';

interface SessionSummary {
  session_id?: string;
  session_name?: string;
  agent_type?: string;
}

interface SessionControlInput {
  action?: 'create' | 'cancel' | 'delete' | 'list';
  workspace?: string;
  session_id?: string;
  session_name?: string;
  agent_type?: string;
}

interface SessionControlResult {
  success?: boolean;
  action?: 'create' | 'cancel' | 'delete' | 'list';
  workspace?: string;
  count?: number;
  session_id?: string;
  had_active_turn?: boolean;
  cancelled_turn_id?: string;
  status?: 'cancel_requested' | 'no_active_turn';
  session?: SessionSummary;
  sessions?: SessionSummary[];
}

function parseData<T>(value: unknown): T | null {
  if (!value) return null;

  try {
    return typeof value === 'string' ? JSON.parse(value) as T : value as T;
  } catch {
    return null;
  }
}

export const SessionControlToolCard: React.FC<ToolCardProps> = React.memo(({
  toolItem,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const toolId = toolItem.id ?? toolCall?.id;

  const inputData = useMemo(
    () => parseData<SessionControlInput>(toolCall?.input) ?? {},
    [toolCall?.input]
  );

  const resultData = useMemo(
    () => parseData<SessionControlResult>(toolResult?.result),
    [toolResult?.result]
  );

  const action = resultData?.action ?? inputData.action ?? 'list';
  const workspace = resultData?.workspace ?? inputData.workspace;
  const session = resultData?.session;
  const sessionId = session?.session_id ?? resultData?.session_id ?? inputData.session_id;
  const sessionName = session?.session_name ?? inputData.session_name;
  const agentType = session?.agent_type ?? inputData.agent_type;
  const sessions = Array.isArray(resultData?.sessions) ? resultData.sessions : [];
  const sessionCount = resultData?.count ?? sessions.length;
  const cancelStatus = resultData?.status;
  const hadActiveTurn = resultData?.had_active_turn;
  const cancelledTurnId = resultData?.cancelled_turn_id;
  const hasDetails = Boolean(
    workspace ||
    sessionId ||
    sessionName ||
    agentType ||
    sessions.length ||
    cancelStatus ||
    hadActiveTurn !== undefined ||
    cancelledTurnId ||
    toolResult?.error
  );

  const getActionLabel = () => {
    switch (action) {
      case 'create':
        return sessionName || t('toolCards.sessionControl.defaultSessionName');
      case 'cancel':
      case 'delete':
        return sessionId || t('toolCards.sessionControl.unknownSession');
      case 'list':
      default:
        return workspace || t('toolCards.sessionControl.agenticScope');
    }
  };

  const renderContent = () => {
    const label = getActionLabel();

    if (status === 'completed') {
      switch (action) {
        case 'create':
          return <>{t('toolCards.sessionControl.createdSession', { session: label })}</>;
        case 'cancel':
          if (cancelStatus === 'no_active_turn') {
            return <>{t('toolCards.sessionControl.noActiveTurn', { session: label })}</>;
          }
          return <>{t('toolCards.sessionControl.cancelledSession', { session: label })}</>;
        case 'delete':
          return <>{t('toolCards.sessionControl.deletedSession', { session: label })}</>;
        case 'list':
        default:
          return <>{t('toolCards.sessionControl.listedSessions', { count: sessionCount })}</>;
      }
    }

    if (status === 'running' || status === 'streaming') {
      switch (action) {
        case 'create':
          return <>{t('toolCards.sessionControl.creatingSession', { session: label })}...</>;
        case 'cancel':
          return <>{t('toolCards.sessionControl.cancellingSession', { session: label })}...</>;
        case 'delete':
          return <>{t('toolCards.sessionControl.deletingSession', { session: label })}...</>;
        case 'list':
        default:
          return <>{t('toolCards.sessionControl.listingSessions')}...</>;
      }
    }

    if (status === 'error' || status === 'cancelled') {
      return <>{t('toolCards.sessionControl.actionFailed')}</>;
    }

    switch (action) {
      case 'create':
        return <>{t('toolCards.sessionControl.preparingCreate', { session: label })}</>;
      case 'cancel':
        return <>{t('toolCards.sessionControl.preparingCancel', { session: label })}</>;
      case 'delete':
        return <>{t('toolCards.sessionControl.preparingDelete', { session: label })}</>;
      case 'list':
      default:
        return <>{t('toolCards.sessionControl.preparingList')}</>;
    }
  };

  const expandedContent = hasDetails ? (
    <ToolStructuredDetails
      rows={[
        { label: `${t('toolCards.sessionControl.workspace')}:`, value: workspace, hidden: !workspace },
        { label: `${t('toolCards.sessionControl.sessionId')}:`, value: sessionId, hidden: !sessionId },
        { label: `${t('toolCards.sessionControl.sessionName')}:`, value: sessionName, hidden: !sessionName },
        { label: `${t('toolCards.sessionControl.agentType')}:`, value: agentType, hidden: !agentType },
        {
          label: `${t('toolCards.sessionControl.cancelStatus')}:`,
          value: cancelStatus === 'no_active_turn'
            ? t('toolCards.sessionControl.noActiveTurnStatus')
            : t('toolCards.sessionControl.cancelRequestedStatus'),
          hidden: action !== 'cancel' || !cancelStatus,
        },
        { label: `${t('toolCards.sessionControl.cancelledTurnId')}:`, value: cancelledTurnId, hidden: action !== 'cancel' || !cancelledTurnId },
        {
          label: `${t('toolCards.sessionControl.hadActiveTurn')}:`,
          value: hadActiveTurn ? t('toolCards.sessionControl.booleanYes') : t('toolCards.sessionControl.booleanNo'),
          hidden: action !== 'cancel' || hadActiveTurn === undefined,
        },
        { label: `${t('toolCards.sessionControl.sessionCount')}:`, value: sessionCount, hidden: action !== 'list' },
      ]}
    >
      {action === 'list' && sessions.length > 0 && (
        <div className="compact-detail-list session-control-session-list">
          {sessions.map((item, index) => (
            <div
              key={`${item.session_id ?? 'session'}-${index}`}
              className="compact-list-item session-control-session-row"
            >
              <span className="session-control-session-row-id">
                {item.session_id || t('toolCards.sessionControl.unknownSession')}
              </span>
              <span className="session-control-session-row-meta">
                {item.session_name || t('toolCards.sessionControl.defaultSessionName')}
              </span>
              <span className="session-control-session-row-meta">
                {item.agent_type || '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {action === 'list' && sessions.length === 0 && status === 'completed' && (
        <div style={{ opacity: 0.7 }}>
          {t('toolCards.sessionControl.noSessions')}
        </div>
      )}

      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </ToolStructuredDetails>
  ) : null;

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="session-control-card"
      action={`${t('toolCards.sessionControl.title')}:`}
      summary={renderContent()}
      extra={action === 'list' && status === 'completed' ? `${sessionCount}` : undefined}
      expandedContent={expandedContent}
    />
  );
});
