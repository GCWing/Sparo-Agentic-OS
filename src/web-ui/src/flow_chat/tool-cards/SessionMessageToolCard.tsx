import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolJsonPreview } from './ToolJsonPreview';
import { ToolStructuredDetails } from './ToolStructuredDetails';

interface SessionMessageInput {
  workspace?: string;
  session_id?: string;
  message?: string;
  agent_type?: string;
}

interface SessionMessageResult {
  success?: boolean;
  target_workspace?: string;
  target_session_id?: string;
  target_agent_type?: string;
}

function parseData<T>(value: unknown): T | null {
  if (!value) return null;

  try {
    return typeof value === 'string' ? JSON.parse(value) as T : value as T;
  } catch {
    return null;
  }
}

export const SessionMessageToolCard: React.FC<ToolCardProps> = React.memo(({
  toolItem,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const toolId = toolItem.id ?? toolCall?.id;

  const inputData = useMemo(
    () => parseData<SessionMessageInput>(toolCall?.input) ?? {},
    [toolCall?.input]
  );

  const resultData = useMemo(
    () => parseData<SessionMessageResult>(toolResult?.result),
    [toolResult?.result]
  );

  const targetSessionId = resultData?.target_session_id ?? inputData.session_id;
  const workspace = resultData?.target_workspace ?? inputData.workspace;
  const agentType = resultData?.target_agent_type ?? inputData.agent_type;
  const message = inputData.message ?? '';
  const hasDetails = Boolean(targetSessionId || workspace || agentType || message || toolResult?.error);

  const targetLabel = targetSessionId || t('toolCards.sessionMessage.unknownSession');

  const renderContent = () => {
    if (status === 'completed') {
      return <>{t('toolCards.sessionMessage.messageAccepted', { session: targetLabel })}</>;
    }

    if (status === 'running' || status === 'streaming') {
      return <>{t('toolCards.sessionMessage.sendingMessage', { session: targetLabel })}...</>;
    }

    if (status === 'error' || status === 'cancelled') {
      return <>{t('toolCards.sessionMessage.sendFailed', { session: targetLabel })}</>;
    }

    return <>{t('toolCards.sessionMessage.preparingSend', { session: targetLabel })}</>;
  };

  const expandedContent = hasDetails ? (
    <ToolStructuredDetails
      rows={[
        { label: `${t('toolCards.sessionMessage.targetSession')}:`, value: targetSessionId, hidden: !targetSessionId },
        { label: `${t('toolCards.sessionMessage.workspace')}:`, value: workspace, hidden: !workspace },
        { label: `${t('toolCards.sessionMessage.agentType')}:`, value: agentType, hidden: !agentType },
        { label: `${t('toolCards.sessionMessage.message')}:`, value: message ? <ToolJsonPreview value={message} /> : null, hidden: !message },
      ]}
    >
      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </ToolStructuredDetails>
  ) : null;

  return (
    <CompactToolTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="session-message-card"
      action={`${t('toolCards.sessionMessage.title')}:`}
      summary={renderContent()}
      extra={agentType ? agentType : undefined}
      expandedContent={expandedContent}
    />
  );
});
